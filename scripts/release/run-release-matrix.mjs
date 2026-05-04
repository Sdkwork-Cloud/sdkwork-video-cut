#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { normalizeCliArgs } from '../lib/cli-args.mjs';
import { findLocalAbsolutePath, reportContainsSensitiveData, sanitizeErrorMessage } from '../lib/report-safety.mjs';
import { createReportPath } from '../lib/report-paths.mjs';
import { createReleaseWithGovernanceReport } from './run-release-with-governance.mjs';

const REPORT_VERSION = 'video-cut.release-matrix-report.v1';
const COMMAND = 'release:package:matrix';
const DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release-matrix';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const MATRIX_TARGETS = ['desktop', 'server', 'web', 'container', 'kubernetes'];
const REQUIRED_STANDARD_FILES = [
  'release-manifest.json',
  'quality-gate-execution-report.json',
  'SHA256SUMS.txt',
  'release-notes.md',
  'governance-evidence-bundle.json',
  'provenance.json',
  'release-signature.json',
  'sdkwork-video-cut-sbom.cdx.json',
];

export function parseReleaseMatrixArgs(argv) {
  const args = normalizeCliArgs(argv);
  let json = false;
  let releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR;
  let reportDir = DEFAULT_REPORT_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
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

    throw new Error(`Unknown release matrix argument: ${arg}`);
  }

  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  return {
    json,
    releaseAssetsDir: normalizeProjectPath(releaseAssetsDir),
    reportDir: normalizeProjectPath(reportDir),
  };
}

export async function createReleaseMatrixReport({
  projectRoot = process.cwd(),
  releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR,
  reportDir = DEFAULT_REPORT_DIR,
  releaseWithGovernanceImpl = createReleaseWithGovernanceReport,
} = {}) {
  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const normalizedReportDir = normalizeProjectPath(reportDir);
  const generatedAt = new Date().toISOString();
  const targets = [];

  for (const target of MATRIX_TARGETS) {
    const targetReleaseAssetsDir = `${normalizedReleaseAssetsDir}/${target}`;
    const targetReportDir = `${normalizedReportDir}/release-matrix/${target}`;
    const releaseReport = await runTargetRelease({
      projectRoot,
      releaseWithGovernanceImpl,
      reportDir: targetReportDir,
      target,
      targetReleaseAssetsDir,
    });
    targets.push(
      createTargetEvidence({
        projectRoot,
        releaseReport,
        target,
        targetReleaseAssetsDir,
      }),
    );
  }

  const checks = [
    checkTargetCoverage(targets),
    checkIsolatedReleaseDirectories(targets, normalizedReleaseAssetsDir),
    ...targets.map((targetEvidence) => checkTargetRelease(targetEvidence)),
    checkMatrixJsonSafety(targets),
  ];
  const summary = summarizeChecks(checks);
  const targetSummary = summarizeTargets(targets);
  const { absolutePath, reportPath } = createReportPath(
    projectRoot,
    normalizedReportDir,
    'release-matrix-report.json',
  );
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summary.fail === 0 && targetSummary.fail === 0 ? 'pass' : 'fail',
    generatedAt,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    reportPath,
    targetSummary,
    summary,
    checks,
    targets,
  };
  writeReport(absolutePath, report);
  return report;
}

async function runTargetRelease({ projectRoot, releaseWithGovernanceImpl, reportDir, target, targetReleaseAssetsDir }) {
  try {
    return await releaseWithGovernanceImpl({
      action: 'package',
      projectRoot,
      releaseAssetsDir: targetReleaseAssetsDir,
      reportDir,
      target,
    });
  } catch (error) {
    return {
      reportVersion: 'video-cut.release-with-governance.v1',
      action: 'package',
      target,
      status: 'fail',
      releaseAssetsDir: targetReleaseAssetsDir,
      summary: { pass: 0, warn: 0, fail: 1 },
      releaseContracts: {
        reportVersion: 'video-cut.release-contracts-report.v1',
        command: 'check:release-contracts',
        action: 'package',
        target,
        status: 'missing',
        releaseAssetsDir: targetReleaseAssetsDir,
        reportPath: '',
        summary: { pass: 0, warn: 0, fail: 1 },
      },
      signatureVerification: {
        reportVersion: 'video-cut.release-signature-verification.v1',
        command: 'verify:release-signature',
        action: 'package',
        target,
        status: 'missing',
        releaseAssetsDir: targetReleaseAssetsDir,
        reportPath: '',
        summary: { pass: 0, warn: 0, fail: 1 },
      },
      error: {
        code: 'RELEASE_MATRIX_TARGET_FAILED',
        message: sanitizeErrorMessage(error),
      },
    };
  }
}

function createTargetEvidence({ projectRoot, releaseReport, target, targetReleaseAssetsDir }) {
  const releaseRoot = resolve(projectRoot, targetReleaseAssetsDir);
  const manifest = readJsonFile(resolve(releaseRoot, 'release-manifest.json'));
  const standardArtifacts = {
    manifest: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/release-manifest.json`),
    checksums: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/SHA256SUMS.txt`),
    releaseNotes: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/release-notes.md`),
    qualityGateReport: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/quality-gate-execution-report.json`),
    governanceEvidenceBundle: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/governance-evidence-bundle.json`),
    provenance: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/provenance.json`),
    releaseSignature: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/release-signature.json`),
    sbom: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/sdkwork-video-cut-sbom.cdx.json`),
    actionReport: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/${target}-package-report.json`),
  };
  const missingStandardFiles = [
    ...REQUIRED_STANDARD_FILES,
    `${target}-package-report.json`,
  ].filter((fileName) => !existsSync(resolve(releaseRoot, fileName)));
  const releaseContracts = releaseReport?.releaseContracts ?? {};
  const signatureVerification = releaseReport?.signatureVerification ?? {};
  const status =
    releaseReport?.status === 'pass' &&
    releaseContracts?.status === 'pass' &&
    signatureVerification?.status === 'pass' &&
    manifest.value?.status === 'pass' &&
    missingStandardFiles.length === 0
      ? 'pass'
      : 'fail';

  return {
    target,
    action: 'package',
    status,
    releaseAssetsDir: targetReleaseAssetsDir,
    manifestPath: `${targetReleaseAssetsDir}/release-manifest.json`,
    standardArtifacts,
    missingStandardFiles,
    manifest: {
      exists: manifest.exists,
      action: manifest.value?.action ?? '',
      target: manifest.value?.target ?? '',
      status: manifest.value?.status ?? '',
      artifactCount: Array.isArray(manifest.value?.artifacts) ? manifest.value.artifacts.length : 0,
      includesProvenance: artifactExists(manifest.value, 'provenance.json'),
      includesReleaseSignature: artifactExists(manifest.value, 'release-signature.json'),
      includesSbom: artifactExists(manifest.value, 'sdkwork-video-cut-sbom.cdx.json'),
      parseError: manifest.error,
    },
    releaseReport: toReleaseReportEvidence(releaseReport),
    releaseContracts: toReleaseContractsEvidence(releaseContracts),
    signatureVerification: toSignatureVerificationEvidence(signatureVerification),
  };
}

function toReleaseReportEvidence(report) {
  return {
    reportVersion: report?.reportVersion ?? '',
    action: report?.action ?? '',
    target: report?.target ?? '',
    status: report?.status ?? 'missing',
    summary: report?.summary ?? {},
    actionReportPath: report?.actionReportPath ?? '',
    manifestPath: report?.manifestPath ?? '',
    checksumsPath: report?.checksumsPath ?? '',
    qualityGateReportPath: report?.qualityGateReportPath ?? '',
    provenancePath: report?.provenancePath ?? '',
    signaturePath: report?.signaturePath ?? '',
    error: report?.error ?? null,
  };
}

function toReleaseContractsEvidence(report) {
  return {
    reportVersion: report?.reportVersion ?? '',
    command: report?.command ?? '',
    action: report?.action ?? '',
    target: report?.target ?? '',
    status: report?.status ?? 'missing',
    releaseAssetsDir: report?.releaseAssetsDir ?? '',
    reportPath: report?.reportPath ?? '',
    summary: report?.summary ?? {},
  };
}

function toSignatureVerificationEvidence(report) {
  return {
    reportVersion: report?.reportVersion ?? '',
    command: report?.command ?? '',
    action: report?.action ?? '',
    target: report?.target ?? '',
    status: report?.status ?? 'missing',
    releaseAssetsDir: report?.releaseAssetsDir ?? '',
    reportPath: report?.reportPath ?? '',
    summary: report?.summary ?? {},
  };
}

function checkTargetCoverage(targets) {
  const actual = targets.map((target) => target.target);
  const missing = MATRIX_TARGETS.filter((target) => !actual.includes(target));
  const extra = actual.filter((target) => !MATRIX_TARGETS.includes(target));
  return checkResult({
    id: 'release-matrix-target-coverage',
    passed: missing.length === 0 && extra.length === 0 && actual.length === MATRIX_TARGETS.length,
    evidence: MATRIX_TARGETS.join(', '),
    failMessage: `Release matrix target coverage drift. Missing: ${missing.join(', ')} extra: ${extra.join(', ')}`,
  });
}

function checkIsolatedReleaseDirectories(targets, releaseAssetsDir) {
  const expected = MATRIX_TARGETS.map((target) => `${releaseAssetsDir}/${target}`);
  const actual = targets.map((target) => target.releaseAssetsDir);
  return checkResult({
    id: 'release-matrix-isolated-assets',
    passed: deepEqual(actual, expected) && new Set(actual).size === actual.length,
    evidence: expected.join(', '),
    failMessage: `Release matrix must use one isolated release assets directory per target. Actual: ${actual.join(', ')}`,
  });
}

function checkTargetRelease(targetEvidence) {
  const failures = [];
  if (targetEvidence.status !== 'pass') {
    failures.push('target status');
  }
  if (targetEvidence.releaseReport.status !== 'pass') {
    failures.push('release package');
  }
  if (targetEvidence.releaseContracts.status !== 'pass') {
    failures.push('release contracts');
  }
  if (targetEvidence.signatureVerification.status !== 'pass') {
    failures.push('signature verification');
  }
  if (targetEvidence.manifest.action !== 'package') {
    failures.push('manifest action');
  }
  if (targetEvidence.manifest.target !== targetEvidence.target) {
    failures.push('manifest target');
  }
  if (targetEvidence.manifest.status !== 'pass') {
    failures.push('manifest status');
  }
  if (!targetEvidence.manifest.includesProvenance) {
    failures.push('manifest provenance');
  }
  if (!targetEvidence.manifest.includesReleaseSignature) {
    failures.push('manifest release signature');
  }
  if (!targetEvidence.manifest.includesSbom) {
    failures.push('manifest SBOM');
  }
  if (targetEvidence.missingStandardFiles.length > 0) {
    failures.push(`missing files: ${targetEvidence.missingStandardFiles.join(', ')}`);
  }

  return checkResult({
    id: `release-matrix-${targetEvidence.target}-package-contract`,
    passed: failures.length === 0,
    evidence: `${targetEvidence.releaseAssetsDir}: package and release contracts passed.`,
    failMessage: `${targetEvidence.target} release matrix package is not deliverable: ${failures.join(', ')}`,
  });
}

function checkMatrixJsonSafety(targets) {
  const sensitive = reportContainsSensitiveData(targets);
  const localPath = findLocalAbsolutePath(targets);
  return checkResult({
    id: 'release-matrix-redaction-and-path-safety',
    passed: !sensitive && !localPath,
    evidence: 'Release matrix report contains no credential-shaped values and no server-local absolute paths.',
    failMessage: `Release matrix report must not contain sensitive data or local paths. Sensitive=${sensitive} localPath=${localPath}`,
  });
}

function createFileEvidence(projectRoot, path) {
  const normalizedPath = normalizeProjectPath(path);
  const absolutePath = resolve(projectRoot, normalizedPath);
  if (!existsSync(absolutePath)) {
    return {
      path: normalizedPath,
      exists: false,
      sha256: '',
      sizeBytes: 0,
    };
  }

  const bytes = readFileSync(absolutePath);
  return {
    path: normalizedPath,
    exists: true,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: statSync(absolutePath).size,
  };
}

function readJsonFile(path) {
  if (!existsSync(path)) {
    return { exists: false, value: undefined, error: 'missing' };
  }

  try {
    return { exists: true, value: JSON.parse(readFileSync(path, 'utf8')), error: '' };
  } catch (error) {
    return {
      exists: true,
      value: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function artifactExists(manifest, path) {
  return Array.isArray(manifest?.artifacts) && manifest.artifacts.some((artifact) => artifact?.path === path);
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

function summarizeTargets(targets) {
  return targets.reduce(
    (summary, target) => {
      summary.total += 1;
      summary[target.status === 'pass' ? 'pass' : 'fail'] += 1;
      return summary;
    },
    { total: 0, pass: 0, warn: 0, fail: 0 },
  );
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

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function checkResult({ evidence, failMessage, id, passed }) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    evidence: passed ? evidence : failMessage,
  };
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printHumanReport(report) {
  const lines = [
    'SDKWork Video Cut Release Matrix',
    `releaseAssetsDir: ${report.releaseAssetsDir}`,
    `status: ${report.status}`,
    `targets: ${report.targetSummary.pass} pass, ${report.targetSummary.fail} fail`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    '',
    ...report.targets.map((target) => `${target.status.toUpperCase()} ${target.target}: ${target.releaseAssetsDir}`),
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
    const options = parseReleaseMatrixArgs(process.argv.slice(2));
    const report = await createReleaseMatrixReport(options);
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
            code: 'RELEASE_MATRIX_FAILED',
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
