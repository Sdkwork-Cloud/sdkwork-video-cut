#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { normalizeCliArgs } from './lib/cli-args.mjs';
import { createRemediationSummary } from './lib/release-remediation-summary.mjs';
import { createReportPath } from './lib/report-paths.mjs';
import { findLocalAbsolutePath, reportContainsSensitiveData, sanitizeErrorMessage } from './lib/report-safety.mjs';

const REPORT_VERSION = 'video-cut.release-smoke-readiness-report.v1';
const COMMAND = 'check:release-smoke-readiness';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const DEFAULT_PREFLIGHT_REPORT_PATH = 'artifacts/governance/release-smoke-preflight-report.json';
const DEFAULT_MATRIX_REPORT_PATH = 'artifacts/governance/release-smoke-matrix-report.json';
const MATRIX_TARGETS = ['desktop', 'server', 'web', 'container', 'kubernetes'];
const STANDARD_BLOCKER_CODES = new Set([
  'RELEASE_SMOKE_ENV_TOOL_SPAWN_BLOCKED',
  'RELEASE_SMOKE_ENV_BROWSER_UNAVAILABLE',
  'RELEASE_SMOKE_ENV_PORTS_UNAVAILABLE',
  'RELEASE_SMOKE_ENV_WORKSPACE_UNWRITABLE',
  'RELEASE_SMOKE_ENV_REQUIRED_FILE_MISSING',
  'RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED',
]);

export function parseReleaseSmokeReadinessArgs(argv) {
  const args = normalizeCliArgs(argv);
  let json = false;
  let matrixReportPath = DEFAULT_MATRIX_REPORT_PATH;
  let preflightReportPath = DEFAULT_PREFLIGHT_REPORT_PATH;
  let requireReady = false;
  let reportDir = DEFAULT_REPORT_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--require-ready') {
      requireReady = true;
      continue;
    }

    if (arg === '--matrix-report') {
      matrixReportPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--preflight-report') {
      preflightReportPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--report-dir') {
      reportDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown release smoke readiness argument: ${arg}`);
  }

  assertProjectRelativePath('preflightReportPath', preflightReportPath);
  assertProjectRelativePath('matrixReportPath', matrixReportPath);
  assertProjectRelativePath('reportDir', reportDir);
  return {
    json,
    requireReady,
    preflightReportPath: normalizeProjectPath(preflightReportPath),
    matrixReportPath: normalizeProjectPath(matrixReportPath),
    reportDir: normalizeProjectPath(reportDir),
  };
}

export function createReleaseSmokeReadinessReport({
  projectRoot = process.cwd(),
  reportDir = DEFAULT_REPORT_DIR,
  preflightReportPath = DEFAULT_PREFLIGHT_REPORT_PATH,
  matrixReportPath = DEFAULT_MATRIX_REPORT_PATH,
  requireReady = false,
  readJsonImpl = readJsonReport,
} = {}) {
  assertProjectRelativePath('preflightReportPath', preflightReportPath);
  assertProjectRelativePath('matrixReportPath', matrixReportPath);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedReportDir = normalizeProjectPath(reportDir);
  const normalizedPreflightReportPath = normalizeProjectPath(preflightReportPath);
  const normalizedMatrixReportPath = normalizeProjectPath(matrixReportPath);
  const preflightRead = readReport({
    path: normalizedPreflightReportPath,
    projectRoot,
    readJsonImpl,
  });
  const matrixRead = readReport({
    path: normalizedMatrixReportPath,
    projectRoot,
    readJsonImpl,
  });
  const preflight = toPreflightEvidence(preflightRead.report, normalizedPreflightReportPath, preflightRead.error);
  const matrix = toMatrixEvidence(matrixRead.report, normalizedMatrixReportPath, matrixRead.error);
  const readyClassification = validateReadyClassification({ matrix, preflight });
  const blockedClassification = validateBlockedClassification({ matrix, preflight });
  const readinessStatus = readyClassification.valid ? 'ready' : blockedClassification.valid ? 'blocked' : 'failed';
  const environmentStatus = readinessStatus === 'ready' ? 'ready' : readinessStatus === 'blocked' ? 'blocked' : 'failed';
  const promotionEligible = readinessStatus === 'ready';
  const environmentBlockers = readinessStatus === 'blocked'
    ? mergeEnvironmentBlockers(preflight.environmentBlockers, matrix.environmentBlockers)
    : [];
  const remediationSummary = createRemediationSummary(preflight, matrix, { environmentBlockers });
  const checks = [
    checkPreflightReportContract(preflight),
    checkMatrixReportContract(matrix),
    checkClassificationContract({ blockedClassification, readyClassification }),
    checkReadyRequired({ readinessStatus, requireReady }),
    checkPromotionEligible({ promotionEligible, readinessStatus }),
    checkEnvironmentBlockerContract({ matrix, preflight, readinessStatus }),
    checkTargetCoverage(matrix),
    checkReportSafety({ matrix, preflight }),
  ];
  const summary = summarizeChecks(checks);
  const { absolutePath, reportPath } = createReportPath(
    projectRoot,
    normalizedReportDir,
    'release-smoke-readiness-report.json',
  );
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summary.fail === 0 ? 'pass' : 'fail',
    requireReady,
    readinessStatus,
    promotionEligible,
    environmentStatus,
    environmentBlockers,
    remediationSummary,
    checkedAt: new Date().toISOString(),
    preflightReportPath: normalizedPreflightReportPath,
    matrixReportPath: normalizedMatrixReportPath,
    reportPath,
    preflight,
    matrix,
    summary,
    checks,
  };
  writeReport(absolutePath, report);
  return report;
}

function checkPromotionEligible({ promotionEligible, readinessStatus }) {
  return checkResult({
    id: 'release-smoke-readiness-promotion-eligible',
    passed: promotionEligible === (readinessStatus === 'ready'),
    evidence: promotionEligible
      ? 'Release smoke readiness is promotion eligible.'
      : `Release smoke readiness is not promotion eligible because readinessStatus=${readinessStatus}.`,
    failMessage: `Release smoke readiness promotionEligible drift: promotionEligible=${promotionEligible} readinessStatus=${readinessStatus}.`,
  });
}

function checkReadyRequired({ readinessStatus, requireReady }) {
  if (!requireReady) {
    return checkResult({
      id: 'release-smoke-readiness-ready-required',
      passed: true,
      evidence: 'Classification mode allows ready or blocked release smoke evidence without promoting blocked evidence to deliverable.',
      failMessage: '',
    });
  }

  return checkResult({
    id: 'release-smoke-readiness-ready-required',
    passed: readinessStatus === 'ready',
    evidence: 'Commercial release readiness requires readinessStatus=ready.',
    failMessage: `Commercial release readiness requires readinessStatus=ready; current readinessStatus=${readinessStatus}.`,
  });
}

function readReport({ path, projectRoot, readJsonImpl }) {
  try {
    return { report: readJsonImpl(path, { projectRoot }), error: '' };
  } catch (error) {
    return { report: undefined, error: sanitizeErrorMessage(error) };
  }
}

function readJsonReport(path, { projectRoot } = {}) {
  const absolutePath = resolve(projectRoot ?? process.cwd(), path);
  if (!existsSync(absolutePath)) {
    throw new Error(`Report is missing: ${path}`);
  }
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function toPreflightEvidence(report, path, readError) {
  return {
    reportVersion: report?.reportVersion ?? '',
    command: report?.command ?? '',
    status: report?.status ?? 'missing',
    environmentStatus: report?.environmentStatus ?? 'missing',
    environmentBlockers: toEnvironmentBlockers(report?.environmentBlockers),
    reportPath: report?.reportPath ?? path,
    summary: report?.summary ?? {},
    checks: toChecks(report?.checks),
    error: readError ? { code: 'RELEASE_SMOKE_READINESS_PREFLIGHT_REPORT_UNREADABLE', message: readError } : report?.error ?? null,
  };
}

function toMatrixEvidence(report, path, readError) {
  return {
    reportVersion: report?.reportVersion ?? '',
    command: report?.command ?? '',
    status: report?.status ?? 'missing',
    environmentStatus: report?.environmentStatus ?? 'missing',
    environmentBlockers: toEnvironmentBlockers(report?.environmentBlockers),
    reportPath: report?.reportPath ?? path,
    targetSummary: report?.targetSummary ?? {},
    summary: report?.summary ?? {},
    checks: toChecks(report?.checks),
    targets: Array.isArray(report?.targets) ? report.targets.map(toTargetEvidence) : [],
    error: readError ? { code: 'RELEASE_SMOKE_READINESS_MATRIX_REPORT_UNREADABLE', message: readError } : report?.error ?? null,
  };
}

function toTargetEvidence(target) {
  return {
    target: target?.target ?? '',
    status: target?.status ?? 'missing',
    environmentBlockers: toEnvironmentBlockers(target?.environmentBlockers),
    smoke: {
      reportVersion: target?.smoke?.reportVersion ?? '',
      ok: target?.smoke?.ok ?? false,
      summary: target?.smoke?.summary ?? {},
      error: target?.smoke?.error ?? null,
    },
    smokeEvidenceContracts: {
      status: target?.smokeEvidenceContracts?.status ?? 'missing',
      summary: target?.smokeEvidenceContracts?.summary ?? {},
      error: target?.smokeEvidenceContracts?.error ?? null,
    },
    releaseReport: {
      status: target?.releaseReport?.status ?? 'missing',
      summary: target?.releaseReport?.summary ?? {},
      error: target?.releaseReport?.error ?? null,
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

function toChecks(checks) {
  return Array.isArray(checks)
    ? checks.map((check) => ({
        id: check?.id ?? '',
        status: check?.status ?? 'missing',
        evidence: sanitizeErrorMessage(check?.evidence ?? ''),
      }))
    : [];
}

function toEnvironmentBlockers(blockers) {
  return Array.isArray(blockers)
    ? blockers.map((blocker) => ({
        id: blocker?.id ?? '',
        code: blocker?.code ?? '',
        category: blocker?.category ?? '',
        evidence: sanitizeErrorMessage(blocker?.evidence ?? ''),
      }))
    : [];
}

function checkPreflightReportContract(preflight) {
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
  if (preflight.error) {
    failures.push(preflight.error.code ?? 'readError');
  }

  return checkResult({
    id: 'release-smoke-readiness-preflight-report-contract',
    passed: failures.length === 0,
    evidence: `${preflight.reportPath}: release smoke preflight report contract is parseable.`,
    failMessage: `Release smoke preflight report contract drift: ${failures.join(', ')}`,
  });
}

function checkMatrixReportContract(matrix) {
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
  if (matrix.error) {
    failures.push(matrix.error.code ?? 'readError');
  }

  return checkResult({
    id: 'release-smoke-readiness-matrix-report-contract',
    passed: failures.length === 0,
    evidence: `${matrix.reportPath}: release smoke matrix report contract is parseable.`,
    failMessage: `Release smoke matrix report contract drift: ${failures.join(', ')}`,
  });
}

function checkClassificationContract({ blockedClassification, readyClassification }) {
  return checkResult({
    id: 'release-smoke-readiness-classification-contract',
    passed: readyClassification.valid || blockedClassification.valid,
    evidence:
      readyClassification.valid
        ? 'Release smoke reports classify as ready with all five target smoke records passed.'
        : 'Release smoke reports classify as blocked with structured environment blockers and no target smoke execution.',
    failMessage: `Release smoke readiness must be either ready/pass or blocked with blockers. Ready failures: ${readyClassification.reason}; blocked failures: ${blockedClassification.reason}`,
  });
}

function checkEnvironmentBlockerContract({ matrix, preflight, readinessStatus }) {
  if (readinessStatus === 'ready') {
    return checkResult({
      id: 'release-smoke-readiness-environment-blockers',
      passed: preflight.environmentBlockers.length === 0 && matrix.environmentBlockers.length === 0,
      evidence: 'Ready smoke reports carry no environment blockers.',
      failMessage: 'Ready smoke reports must not carry environment blockers.',
    });
  }

  if (readinessStatus !== 'blocked') {
    return checkResult({
      id: 'release-smoke-readiness-environment-blockers',
      passed: false,
      evidence: '',
      failMessage: 'Failed smoke readiness classification cannot prove environment blocker semantics.',
    });
  }

  const blockerFailures = [
    ...validateBlockerList('preflight.environmentBlockers', preflight.environmentBlockers),
    ...validateBlockerList('matrix.environmentBlockers', matrix.environmentBlockers),
  ];
  if (!containsAllBlockers(matrix.environmentBlockers, preflight.environmentBlockers)) {
    blockerFailures.push('matrix.environmentBlockers must include all preflight blockers');
  }
  for (const target of matrix.targets) {
    if (!containsAllBlockers(target.environmentBlockers, preflight.environmentBlockers)) {
      blockerFailures.push(`${target.target}.environmentBlockers must include all preflight blockers`);
    }
  }

  return checkResult({
    id: 'release-smoke-readiness-environment-blockers',
    passed: blockerFailures.length === 0,
    evidence: `${preflight.environmentBlockers.length} structured environment blockers are propagated from preflight into matrix and target records.`,
    failMessage: `Release smoke blocker contract drift: ${blockerFailures.join('; ')}`,
  });
}

function checkTargetCoverage(matrix) {
  const actual = matrix.targets.map((target) => target.target);
  const missing = MATRIX_TARGETS.filter((target) => !actual.includes(target));
  const extra = actual.filter((target) => !MATRIX_TARGETS.includes(target));
  return checkResult({
    id: 'release-smoke-readiness-target-coverage',
    passed:
      Number(matrix.targetSummary.total ?? matrix.targets.length) === MATRIX_TARGETS.length &&
      matrix.targets.length === MATRIX_TARGETS.length &&
      missing.length === 0 &&
      extra.length === 0,
    evidence: MATRIX_TARGETS.join(', '),
    failMessage: `Release smoke matrix target coverage drift. Missing: ${missing.join(', ')} extra: ${extra.join(', ')}`,
  });
}

function checkReportSafety({ matrix, preflight }) {
  const reportEvidence = { matrix, preflight };
  const sensitive = reportContainsSensitiveData(reportEvidence);
  const localPath = findLocalAbsolutePath(reportEvidence);
  return checkResult({
    id: 'release-smoke-readiness-redaction-and-path-safety',
    passed: !sensitive && !localPath,
    evidence: 'Release smoke readiness report contains no credential-shaped values and no server-local absolute paths.',
    failMessage: `Release smoke readiness report must not contain sensitive data or local paths. Sensitive=${sensitive} localPath=${localPath}`,
  });
}

function validateReadyClassification({ matrix, preflight }) {
  const failures = [];
  if (preflight.status !== 'pass' || preflight.environmentStatus !== 'ready') {
    failures.push('preflight must be pass/ready');
  }
  if (preflight.environmentBlockers.length !== 0) {
    failures.push('preflight blockers must be empty');
  }
  if (Number(preflight.summary?.fail ?? 0) !== 0) {
    failures.push('preflight summary.fail must be 0');
  }
  if (matrix.status !== 'pass' || matrix.environmentStatus !== 'ready') {
    failures.push('matrix must be pass/ready');
  }
  if (matrix.environmentBlockers.length !== 0) {
    failures.push('matrix blockers must be empty');
  }
  if (Number(matrix.targetSummary?.total ?? 0) !== MATRIX_TARGETS.length) {
    failures.push('matrix targetSummary.total must cover five targets');
  }
  if (Number(matrix.targetSummary?.pass ?? 0) !== MATRIX_TARGETS.length) {
    failures.push('matrix targetSummary.pass must be 5');
  }
  if (Number(matrix.targetSummary?.fail ?? 0) !== 0 || Number(matrix.targetSummary?.blocked ?? 0) !== 0) {
    failures.push('matrix targetSummary fail/blocked must be 0');
  }
  for (const target of matrix.targets) {
    if (target.status !== 'pass') {
      failures.push(`${target.target} target must pass`);
    }
  }

  return { valid: failures.length === 0, reason: failures.join('; ') || '' };
}

function validateBlockedClassification({ matrix, preflight }) {
  const failures = [];
  if (preflight.status !== 'fail' || preflight.environmentStatus !== 'blocked') {
    failures.push('preflight must be fail/blocked');
  }
  const preflightBlockerFailures = validateBlockerList('preflight.environmentBlockers', preflight.environmentBlockers);
  failures.push(...preflightBlockerFailures);
  if (preflight.environmentBlockers.length === 0) {
    failures.push('preflight must expose at least one blocker');
  }
  if (matrix.status !== 'fail' || matrix.environmentStatus !== 'blocked') {
    failures.push('matrix must be fail/blocked');
  }
  if (!containsAllBlockers(matrix.environmentBlockers, preflight.environmentBlockers)) {
    failures.push('matrix blockers must include preflight blockers');
  }
  if (Number(matrix.targetSummary?.total ?? 0) !== MATRIX_TARGETS.length) {
    failures.push('matrix targetSummary.total must cover five targets');
  }
  if (Number(matrix.targetSummary?.blocked ?? 0) !== MATRIX_TARGETS.length) {
    failures.push('matrix targetSummary.blocked must be 5');
  }
  if (Number(matrix.targetSummary?.pass ?? 0) !== 0) {
    failures.push('matrix targetSummary.pass must be 0');
  }
  for (const target of matrix.targets) {
    if (target.status !== 'blocked') {
      failures.push(`${target.target} target must be blocked`);
    }
    if (target.smoke?.error?.code !== 'RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED') {
      failures.push(`${target.target} target must carry RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED`);
    }
    if (!containsAllBlockers(target.environmentBlockers, preflight.environmentBlockers)) {
      failures.push(`${target.target} target blockers must include preflight blockers`);
    }
  }

  return { valid: failures.length === 0, reason: failures.join('; ') || '' };
}

function validateBlockerList(label, blockers) {
  if (!Array.isArray(blockers) || blockers.length === 0) {
    return [`${label} must be a non-empty array`];
  }
  return blockers.flatMap((blocker, index) => {
    const failures = [];
    if (!blocker.id) {
      failures.push(`${label}[${index}].id`);
    }
    if (!STANDARD_BLOCKER_CODES.has(blocker.code)) {
      failures.push(`${label}[${index}].code`);
    }
    if (!blocker.category) {
      failures.push(`${label}[${index}].category`);
    }
    if (!blocker.evidence) {
      failures.push(`${label}[${index}].evidence`);
    }
    return failures;
  });
}

function containsAllBlockers(candidateBlockers, requiredBlockers) {
  const candidateKeys = new Set(candidateBlockers.map(blockerKey));
  return requiredBlockers.every((blocker) => candidateKeys.has(blockerKey(blocker)));
}

function blockerKey(blocker) {
  return `${blocker.id}|${blocker.code}|${blocker.category}`;
}

function mergeEnvironmentBlockers(...blockerLists) {
  const merged = new Map();
  for (const blockers of blockerLists) {
    for (const blocker of blockers) {
      merged.set(blockerKey(blocker), blocker);
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
    'SDKWork Video Cut Release Smoke Readiness',
    `requireReady: ${report.requireReady}`,
    `readinessStatus: ${report.readinessStatus}`,
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

function main() {
  try {
    const options = parseReleaseSmokeReadinessArgs(process.argv.slice(2));
    const report = createReleaseSmokeReadinessReport(options);
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
            code: 'RELEASE_SMOKE_READINESS_FAILED',
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
  main();
}
