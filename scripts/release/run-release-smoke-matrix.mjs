#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createSmokeEvidenceContractsReport } from '../check-video-cut-smoke-evidence-contracts.mjs';
import { normalizeCliArgs } from '../lib/cli-args.mjs';
import { findLocalAbsolutePath, reportContainsSensitiveData, sanitizeErrorMessage } from '../lib/report-safety.mjs';
import { createReportPath } from '../lib/report-paths.mjs';
import { createHttpWorkflowSmokeReport } from '../run-video-cut-http-workflow-smoke.mjs';
import { createManagedServerWorkflowSmokeReport } from '../run-video-cut-managed-server-smoke.mjs';
import { createManagedUiWorkflowSmokeReport } from '../run-video-cut-managed-ui-smoke.mjs';
import { createReleaseSmokePreflightReport } from './check-release-smoke-preflight.mjs';
import { createReleaseWithGovernanceReport } from './run-release-with-governance.mjs';

const REPORT_VERSION = 'video-cut.release-smoke-matrix-report.v1';
const COMMAND = 'release:smoke:matrix';
const DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release-smoke-matrix';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const DEFAULT_BIND_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 15_000;
const MATRIX_TARGETS = ['desktop', 'server', 'web', 'container', 'kubernetes'];
const TARGET_SMOKE_DEFINITIONS = {
  desktop: {
    deploymentMode: 'desktop-local',
    profile: 'desktop-dev',
    runner: 'http-workflow',
    reportVersion: 'video-cut.http-workflow-smoke.v1',
  },
  server: {
    deploymentMode: 'server-private',
    profile: 'server-dev',
    runner: 'managed-server',
    reportVersion: 'video-cut.managed-server-workflow-smoke.v1',
  },
  web: {
    deploymentMode: 'server-private',
    profile: 'server-dev',
    runner: 'managed-ui',
    reportVersion: 'video-cut.managed-ui-workflow-smoke.v1',
  },
  container: {
    deploymentMode: 'container-private',
    profile: 'container-release',
    runner: 'http-workflow',
    reportVersion: 'video-cut.http-workflow-smoke.v1',
  },
  kubernetes: {
    deploymentMode: 'kubernetes-private',
    profile: 'kubernetes-release',
    runner: 'http-workflow',
    reportVersion: 'video-cut.http-workflow-smoke.v1',
  },
};

export function parseReleaseSmokeMatrixArgs(argv, env = process.env) {
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

    throw new Error(`Unknown release smoke matrix argument: ${arg}`);
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

export async function createReleaseSmokeMatrixReport({
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
  smokeRunners = defaultSmokeRunners(),
  releaseWithGovernanceImpl = createReleaseWithGovernanceReport,
  smokeEvidenceContractsImpl = createSmokeEvidenceContractsReport,
} = {}) {
  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const normalizedReportDir = normalizeProjectPath(reportDir);
  const normalizedSmokeReportDir = normalizeProjectPath(smokeReportDir || `${normalizedReleaseAssetsDir}/smoke`);
  assertProjectRelativePath('smokeReportDir', normalizedSmokeReportDir);
  const generatedAt = new Date().toISOString();
  const targets = [];
  const preflight = toPreflightEvidence(
    await runReleaseSmokePreflight({
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
    }),
  );

  if (preflight.status === 'pass' && preflight.environmentStatus === 'ready') {
    for (const target of MATRIX_TARGETS) {
      const targetSmokeReportPath = `${normalizedSmokeReportDir}/${target}-smoke-report.json`;
      const targetReleaseAssetsDir = `${normalizedReleaseAssetsDir}/${target}`;
      const targetReportDir = `${normalizedReportDir}/release-smoke-matrix/${target}`;
      const targetEvidence = await runTargetSmoke({
        projectRoot,
        releaseWithGovernanceImpl,
        smokeEvidenceContractsImpl,
        smokeReportPath: targetSmokeReportPath,
        smokeRunners,
        target,
        targetReleaseAssetsDir,
        targetReportDir,
      });
      targets.push(targetEvidence);
    }
  } else {
    for (const target of MATRIX_TARGETS) {
      const targetSmokeReportPath = `${normalizedSmokeReportDir}/${target}-smoke-report.json`;
      const targetReleaseAssetsDir = `${normalizedReleaseAssetsDir}/${target}`;
      const targetReportDir = `${normalizedReportDir}/release-smoke-matrix/${target}`;
      targets.push(
        createPreflightBlockedTargetEvidence({
          environmentBlockers: preflight.environmentBlockers,
          projectRoot,
          smokeReportPath: targetSmokeReportPath,
          startedAt: generatedAt,
          target,
          targetReleaseAssetsDir,
          targetReportDir,
        }),
      );
    }
  }

  const checks = [
    checkPreflight(preflight),
    checkTargetCoverage(targets),
    checkIsolatedReleaseDirectories(targets, normalizedReleaseAssetsDir),
    checkIsolatedSmokeReports(targets, normalizedSmokeReportDir),
    ...targets.map((targetEvidence) => checkTargetSmoke(targetEvidence)),
    checkMatrixJsonSafety({ preflight, targets }),
  ];
  const summary = summarizeChecks(checks);
  const targetSummary = summarizeTargets(targets);
  const { absolutePath, reportPath } = createReportPath(
    projectRoot,
    normalizedReportDir,
    'release-smoke-matrix-report.json',
  );
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summary.fail === 0 && targetSummary.fail === 0 ? 'pass' : 'fail',
    environmentStatus: preflight.environmentStatus,
    environmentBlockers: preflight.environmentBlockers,
    generatedAt,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    smokeReportDir: normalizedSmokeReportDir,
    reportPath,
    preflight,
    targetSummary,
    summary,
    checks,
    targets,
  };
  writeReport(absolutePath, report);
  return report;
}

async function runReleaseSmokePreflight({
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
    return await preflightImpl({
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
      reportVersion: 'video-cut.release-smoke-preflight-report.v1',
      command: 'release:smoke:preflight',
      status: 'fail',
      environmentStatus: 'blocked',
      environmentBlockers: [
        {
          id: 'release-smoke-preflight-run',
          code: 'RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED',
          category: 'preflight',
          evidence: sanitizeErrorMessage(error),
        },
      ],
      reportPath: '',
      summary: { pass: 0, warn: 0, fail: 1 },
      error: {
        code: 'RELEASE_SMOKE_PREFLIGHT_FAILED',
        message: sanitizeErrorMessage(error),
      },
      checks: [
        {
          id: 'release-smoke-preflight-run',
          status: 'fail',
          evidence: sanitizeErrorMessage(error),
        },
      ],
    };
  }
}

function createPreflightBlockedTargetEvidence({
  environmentBlockers = [],
  projectRoot,
  smokeReportPath,
  startedAt,
  target,
  targetReleaseAssetsDir,
  targetReportDir,
}) {
  const definition = TARGET_SMOKE_DEFINITIONS[target];
  return createTargetEvidence({
    definition,
    environmentBlockers,
    projectRoot,
    releaseError: null,
    releaseReport: null,
    smokeError: {
      code: 'RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED',
      message: 'Release smoke preflight failed; target smoke was skipped before mutating runtime state.',
    },
    smokeEvidenceReport: {
      reportVersion: 'video-cut.smoke-evidence-contracts-report.v1',
      command: 'check:smoke-evidence',
      status: 'blocked',
      reportPath: '',
      summary: { pass: 0, warn: 0, fail: 1 },
      error: {
        code: 'RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED',
        message: 'Release smoke preflight failed; strict smoke evidence validation was skipped.',
      },
    },
    smokeReport: null,
    smokeReportPath,
    startedAt,
    target,
    targetReleaseAssetsDir,
    targetReportDir,
  });
}

function toPreflightEvidence(report) {
  return {
    reportVersion: report?.reportVersion ?? '',
    command: report?.command ?? '',
    status: report?.status ?? 'missing',
    environmentStatus: report?.environmentStatus ?? 'blocked',
    environmentBlockers: Array.isArray(report?.environmentBlockers)
      ? report.environmentBlockers.map(toEnvironmentBlockerEvidence)
      : [],
    reportPath: report?.reportPath ?? '',
    summary: report?.summary ?? {},
    checks: Array.isArray(report?.checks)
      ? report.checks.map((check) => ({
          id: check?.id ?? '',
          status: check?.status ?? 'missing',
          evidence: check?.evidence ?? '',
        }))
      : [],
    error: report?.error ?? null,
  };
}

function checkPreflight(preflight) {
  const failures = [];
  if (preflight.reportVersion !== 'video-cut.release-smoke-preflight-report.v1') {
    failures.push('report version');
  }
  if (preflight.command !== 'release:smoke:preflight') {
    failures.push('command');
  }
  if (preflight.status !== 'pass') {
    failures.push('status');
  }
  if (preflight.environmentStatus !== 'ready') {
    failures.push('environmentStatus');
  }

  return checkResult({
    id: 'release-smoke-matrix-preflight',
    passed: failures.length === 0,
    evidence: 'Release smoke preflight passed before running the real target smoke matrix.',
    failMessage: `Release smoke matrix blocked by preflight: ${failures.join(', ') || 'unknown failure'}`,
  });
}

function defaultSmokeRunners() {
  return {
    'http-workflow': createHttpWorkflowSmokeReport,
    'managed-server': createManagedServerWorkflowSmokeReport,
    'managed-ui': createManagedUiWorkflowSmokeReport,
  };
}

async function runTargetSmoke({
  projectRoot,
  releaseWithGovernanceImpl,
  smokeEvidenceContractsImpl,
  smokeReportPath,
  smokeRunners,
  target,
  targetReleaseAssetsDir,
  targetReportDir,
}) {
  const definition = TARGET_SMOKE_DEFINITIONS[target];
  const startedAt = new Date().toISOString();
  const runner = smokeRunners[definition.runner];
  let smokeReport;
  let smokeError = null;
  if (typeof runner !== 'function') {
    smokeError = {
      code: 'RELEASE_SMOKE_MATRIX_RUNNER_MISSING',
      message: `Smoke runner is missing for ${target}: ${definition.runner}`,
    };
  } else {
    try {
      smokeReport = await runner({
        deploymentMode: definition.deploymentMode,
        json: true,
        profile: definition.profile,
        projectRoot,
        reportPath: smokeReportPath,
      });
    } catch (error) {
      smokeError = {
        code: 'RELEASE_SMOKE_MATRIX_TARGET_FAILED',
        message: sanitizeErrorMessage(error),
      };
    }
  }

  const smokeEvidenceReport = createSmokeEvidenceForTarget({
    projectRoot,
    smokeEvidenceContractsImpl,
    smokeReportPath,
    target,
    targetReportDir,
  });
  let releaseReport = null;
  let releaseError = null;
  if (!smokeError && smokeReport?.ok === true && smokeEvidenceReport?.status === 'pass') {
    try {
      releaseReport = await releaseWithGovernanceImpl({
        action: 'smoke',
        projectRoot,
        releaseAssetsDir: targetReleaseAssetsDir,
        reportDir: targetReportDir,
        smokeReportPath,
        target,
      });
    } catch (error) {
      releaseError = {
        code: 'RELEASE_SMOKE_MATRIX_PACKAGE_FAILED',
        message: sanitizeErrorMessage(error),
      };
    }
  }

  return createTargetEvidence({
    definition,
    projectRoot,
    releaseError,
    releaseReport,
    smokeError,
    smokeEvidenceReport,
    smokeReport,
    smokeReportPath,
    startedAt,
    target,
    targetReleaseAssetsDir,
    targetReportDir,
  });
}

function createSmokeEvidenceForTarget({ projectRoot, smokeEvidenceContractsImpl, smokeReportPath, target, targetReportDir }) {
  try {
    return smokeEvidenceContractsImpl({
      projectRoot,
      reportDir: targetReportDir,
      smokeReports: [{ path: smokeReportPath, target }],
      strict: true,
    });
  } catch (error) {
    return {
      reportVersion: 'video-cut.smoke-evidence-contracts-report.v1',
      command: 'check:smoke-evidence',
      status: 'fail',
      reportPath: '',
      summary: { pass: 0, warn: 0, fail: 1 },
      error: {
        code: 'RELEASE_SMOKE_MATRIX_EVIDENCE_FAILED',
        message: sanitizeErrorMessage(error),
      },
    };
  }
}

function createTargetEvidence({
  definition,
  environmentBlockers = [],
  projectRoot,
  releaseError,
  releaseReport,
  smokeError,
  smokeEvidenceReport,
  smokeReport,
  smokeReportPath,
  startedAt,
  target,
  targetReleaseAssetsDir,
  targetReportDir,
}) {
  const smokeReportArtifact = createFileEvidence(projectRoot, smokeReportPath);
  const actionReportArtifact = createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/${target}-smoke-report.json`);
  const releaseRootArtifacts = {
    actionReport: actionReportArtifact,
    governanceEvidenceBundle: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/governance-evidence-bundle.json`),
    manifest: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/release-manifest.json`),
    provenance: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/provenance.json`),
    releaseSignature: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/release-signature.json`),
    smokeEvidenceBundle: createFileEvidence(projectRoot, `${targetReleaseAssetsDir}/smoke-evidence-bundle.json`),
  };
  const status =
    smokeError?.code === 'RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED'
      ? 'blocked'
      :
    !smokeError &&
    !releaseError &&
    smokeReport?.ok === true &&
    smokeEvidenceReport?.status === 'pass' &&
    releaseReport?.status === 'pass' &&
    releaseReport?.releaseContracts?.status === 'pass' &&
    releaseReport?.signatureVerification?.status === 'pass'
      ? 'pass'
      : 'fail';

  return {
    target,
    action: 'smoke',
    status,
    runner: definition.runner,
    profile: definition.profile,
    deploymentMode: definition.deploymentMode,
    expectedReportVersion: definition.reportVersion,
    environmentBlockers: environmentBlockers.map(toEnvironmentBlockerEvidence),
    startedAt,
    finishedAt: new Date().toISOString(),
    releaseAssetsDir: targetReleaseAssetsDir,
    reportDir: targetReportDir,
    smokeReportPath,
    smokeReportArtifact,
    smoke: {
      reportVersion: smokeReport?.reportVersion ?? '',
      ok: smokeReport?.ok ?? false,
      summary: smokeReport?.summary ?? {},
      error: smokeError,
    },
    smokeEvidenceContracts: {
      reportVersion: smokeEvidenceReport?.reportVersion ?? '',
      command: smokeEvidenceReport?.command ?? '',
      status: smokeEvidenceReport?.status ?? 'missing',
      reportPath: smokeEvidenceReport?.reportPath ?? '',
      summary: smokeEvidenceReport?.summary ?? {},
      error: smokeEvidenceReport?.error ?? null,
    },
    releaseReport: toReleaseReportEvidence(releaseReport, releaseError),
    releaseContracts: toReleaseContractsEvidence(releaseReport?.releaseContracts),
    signatureVerification: toSignatureVerificationEvidence(releaseReport?.signatureVerification),
    releaseRootArtifacts,
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

function toReleaseReportEvidence(report, releaseError) {
  return {
    reportVersion: report?.reportVersion ?? '',
    action: report?.action ?? '',
    target: report?.target ?? '',
    status: report?.status ?? 'missing',
    summary: report?.summary ?? {},
    actionReportPath: report?.actionReportPath ?? '',
    manifestPath: report?.manifestPath ?? '',
    qualityGateReportPath: report?.qualityGateReportPath ?? '',
    smokeEvidenceBundlePath: report?.smokeEvidenceBundlePath ?? '',
    error: releaseError ?? report?.error ?? null,
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
    id: 'release-smoke-matrix-target-coverage',
    passed: missing.length === 0 && extra.length === 0 && actual.length === MATRIX_TARGETS.length,
    evidence: MATRIX_TARGETS.join(', '),
    failMessage: `Release smoke matrix target coverage drift. Missing: ${missing.join(', ')} extra: ${extra.join(', ')}`,
  });
}

function checkIsolatedReleaseDirectories(targets, releaseAssetsDir) {
  const expected = MATRIX_TARGETS.map((target) => `${releaseAssetsDir}/${target}`);
  const actual = targets.map((target) => target.releaseAssetsDir);
  return checkResult({
    id: 'release-smoke-matrix-isolated-release-assets',
    passed: deepEqual(actual, expected) && new Set(actual).size === actual.length,
    evidence: expected.join(', '),
    failMessage: `Release smoke matrix must use one isolated release assets directory per target. Actual: ${actual.join(', ')}`,
  });
}

function checkIsolatedSmokeReports(targets, smokeReportDir) {
  const expected = MATRIX_TARGETS.map((target) => `${smokeReportDir}/${target}-smoke-report.json`);
  const actual = targets.map((target) => target.smokeReportPath);
  return checkResult({
    id: 'release-smoke-matrix-isolated-smoke-reports',
    passed: deepEqual(actual, expected) && new Set(actual).size === actual.length,
    evidence: expected.join(', '),
    failMessage: `Release smoke matrix must use one project-relative smoke report per target. Actual: ${actual.join(', ')}`,
  });
}

function checkTargetSmoke(targetEvidence) {
  if (targetEvidence.status === 'blocked') {
    return checkResult({
      id: `release-smoke-matrix-${targetEvidence.target}-contract`,
      passed: false,
      evidence: '',
      failMessage: `${targetEvidence.target} release smoke matrix target was skipped by RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED.`,
    });
  }

  const failures = [];
  if (targetEvidence.status !== 'pass') {
    failures.push('target status');
  }
  if (targetEvidence.smoke.reportVersion !== targetEvidence.expectedReportVersion) {
    failures.push('smoke report version');
  }
  if (targetEvidence.smoke.ok !== true) {
    failures.push('smoke ok');
  }
  if (!targetEvidence.smokeReportArtifact.exists) {
    failures.push('smoke report artifact');
  }
  if (targetEvidence.smokeEvidenceContracts.status !== 'pass') {
    failures.push('strict smoke evidence contracts');
  }
  if (targetEvidence.releaseReport.status !== 'pass') {
    failures.push('release smoke package');
  }
  if (targetEvidence.releaseContracts.status !== 'pass') {
    failures.push('release contracts');
  }
  if (targetEvidence.signatureVerification.status !== 'pass') {
    failures.push('signature verification');
  }
  if (!targetEvidence.releaseRootArtifacts.smokeEvidenceBundle.exists) {
    failures.push('smoke evidence bundle');
  }

  return checkResult({
    id: `release-smoke-matrix-${targetEvidence.target}-contract`,
    passed: failures.length === 0,
    evidence: `${targetEvidence.smokeReportPath}: smoke report, strict evidence contracts, release contracts, and signature verification passed.`,
    failMessage: `${targetEvidence.target} release smoke matrix target is not deliverable: ${failures.join(', ')}`,
  });
}

function checkMatrixJsonSafety({ preflight, targets }) {
  const reportEvidence = { preflight, targets };
  const sensitive = reportContainsSensitiveData(reportEvidence);
  const localPath = findLocalAbsolutePath(reportEvidence);
  return checkResult({
    id: 'release-smoke-matrix-redaction-and-path-safety',
    passed: !sensitive && !localPath,
    evidence: 'Release smoke matrix report contains no credential-shaped values and no server-local absolute paths.',
    failMessage: `Release smoke matrix report must not contain sensitive data or local paths. Sensitive=${sensitive} localPath=${localPath}`,
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
      if (target.status === 'pass') {
        summary.pass += 1;
      } else if (target.status === 'blocked') {
        summary.blocked += 1;
        summary.fail += 1;
      } else {
        summary.fail += 1;
      }
      return summary;
    },
    { total: 0, pass: 0, warn: 0, fail: 0, blocked: 0 },
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
    'SDKWork Video Cut Release Smoke Matrix',
    `releaseAssetsDir: ${report.releaseAssetsDir}`,
    `smokeReportDir: ${report.smokeReportDir}`,
    `status: ${report.status}`,
    `targets: ${report.targetSummary.pass} pass, ${report.targetSummary.fail} fail`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    '',
    ...report.targets.map((target) => `${target.status.toUpperCase()} ${target.target}: ${target.smokeReportPath}`),
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
    const options = parseReleaseSmokeMatrixArgs(process.argv.slice(2));
    const report = await createReleaseSmokeMatrixReport(options);
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
            code: 'RELEASE_SMOKE_MATRIX_FAILED',
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
