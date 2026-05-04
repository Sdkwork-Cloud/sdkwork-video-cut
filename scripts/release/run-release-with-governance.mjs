#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { createDatabaseContractsReport } from '../check-video-cut-database-contracts.mjs';
import { createDeploymentArtifactsReport } from '../check-video-cut-deployment-artifacts.mjs';
import { createDeploymentMatrixReport } from '../check-video-cut-deployment-matrix.mjs';
import { createFeatureReadinessPolicyReport } from '../check-video-cut-feature-readiness-policy.mjs';
import { createFeatureReadinessReport } from '../check-video-cut-feature-readiness.mjs';
import { createGovernanceReport } from '../check-video-cut-governance-suite.mjs';
import { createOpenApiContractsReport } from '../check-video-cut-openapi-contracts.mjs';
import { createReleaseContractsReport } from '../check-video-cut-release-contracts.mjs';
import { createSmokeEvidenceContractsReport } from '../check-video-cut-smoke-evidence-contracts.mjs';
import { normalizeCliArgs } from '../lib/cli-args.mjs';
import { createReleaseSignatureVerificationReport } from '../verify-video-cut-release-signature.mjs';
import { createReleaseCommandReport } from './local-release-command.mjs';

const REPORT_VERSION = 'video-cut.release-with-governance.v1';
const ACTIONS = new Set(['package', 'smoke']);
const TARGETS = new Set(['desktop', 'server', 'web', 'container', 'kubernetes']);
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release';

export function parseReleaseWithGovernanceArgs(argv) {
  const args = normalizeCliArgs(argv);
  const action = args.shift();
  const target = args.shift();
  let json = false;
  let releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR;
  let reportDir = DEFAULT_REPORT_DIR;
  let smokeReportPath = '';

  if (!ACTIONS.has(action)) {
    throw new Error('Release governance action must be package or smoke.');
  }

  if (!TARGETS.has(target)) {
    throw new Error('Release target must be desktop, server, web, container, or kubernetes.');
  }

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

    if (arg === '--smoke-report') {
      smokeReportPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown release governance argument: ${arg}`);
  }

  return {
    action,
    json,
    releaseAssetsDir,
    reportDir,
    ...(smokeReportPath ? { smokeReportPath } : {}),
    target,
  };
}

export async function createReleaseWithGovernanceReport({
  action,
  projectRoot = process.cwd(),
  releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR,
  reportDir = DEFAULT_REPORT_DIR,
  smokeReportPath = '',
  target,
}) {
  const { createCliContractsReport } = await import('../check-video-cut-cli-contracts.mjs');
  const governanceReports = [
    await createCliContractsReport({ projectRoot, reportDir }),
    createDatabaseContractsReport({ projectRoot, reportDir }),
    createDeploymentArtifactsReport({ projectRoot, reportDir }),
    createDeploymentMatrixReport({ projectRoot, reportDir }),
    createOpenApiContractsReport({ projectRoot, reportDir }),
    createSmokeEvidenceContractsReport({ projectRoot, reportDir }),
    createGovernanceReport({ category: 'all', projectRoot, reportDir }),
    createFeatureReadinessReport({ projectRoot, reportDir }),
    createFeatureReadinessPolicyReport({ projectRoot, reportDir }),
  ];
  const failedGovernanceReports = governanceReports.filter((report) => report.status !== 'pass');
  if (failedGovernanceReports.length > 0) {
    return {
      reportVersion: REPORT_VERSION,
      action,
      target,
      status: 'fail',
      generatedAt: new Date().toISOString(),
      governanceReports: governanceReports.map(toGovernanceEvidence),
      error: {
        code: 'RELEASE_GOVERNANCE_PREFLIGHT_FAILED',
        message: `Release governance preflight failed: ${failedGovernanceReports
          .map((report) => report.command)
          .join(', ')}`,
      },
    };
  }

  const releaseReport = createReleaseCommandReport({
    action,
    projectRoot,
    releaseAssetsDir,
    reportDir,
    smokeReportPath,
    target,
  });
  const releaseContractsReport = createReleaseContractsReport({
    projectRoot,
    releaseAssetsDir,
    reportDir,
  });
  if (releaseContractsReport.status !== 'pass') {
    return {
      ...releaseReport,
      reportVersion: REPORT_VERSION,
      status: 'fail',
      governanceReports: governanceReports.map(toGovernanceEvidence),
      releaseContracts: toReleaseContractsEvidence(releaseContractsReport),
      error: {
        code: 'RELEASE_CONTRACTS_FAILED',
        message: 'Generated release package failed release contract validation.',
      },
    };
  }
  const signatureVerificationReport = createReleaseSignatureVerificationReport({
    projectRoot,
    releaseAssetsDir,
    reportDir,
  });
  if (signatureVerificationReport.status !== 'pass') {
    return {
      ...releaseReport,
      reportVersion: REPORT_VERSION,
      status: 'fail',
      governanceReports: governanceReports.map(toGovernanceEvidence),
      releaseContracts: toReleaseContractsEvidence(releaseContractsReport),
      signatureVerification: toSignatureVerificationEvidence(signatureVerificationReport),
      error: {
        code: 'RELEASE_SIGNATURE_VERIFICATION_FAILED',
        message: 'Generated release package failed independent release signature verification.',
      },
    };
  }

  return {
    ...releaseReport,
    reportVersion: REPORT_VERSION,
    governanceReports: governanceReports.map(toGovernanceEvidence),
    releaseContracts: toReleaseContractsEvidence(releaseContractsReport),
    signatureVerification: toSignatureVerificationEvidence(signatureVerificationReport),
  };
}

function toGovernanceEvidence(report) {
  return {
    command: report.command,
    reportPath: report.reportPath,
    reportVersion: report.reportVersion,
    status: report.status,
    summary: report.summary,
  };
}

function toReleaseContractsEvidence(report) {
  return {
    action: report.action,
    command: report.command,
    releaseAssetsDir: report.releaseAssetsDir,
    reportPath: report.reportPath,
    reportVersion: report.reportVersion,
    status: report.status,
    summary: report.summary,
    target: report.target,
  };
}

function toSignatureVerificationEvidence(report) {
  return {
    action: report.action,
    command: report.command,
    releaseAssetsDir: report.releaseAssetsDir,
    reportPath: report.reportPath,
    reportVersion: report.reportVersion,
    status: report.status,
    summary: report.summary,
    target: report.target,
  };
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function printHumanReport(report) {
  const lines = [
    'SDKWork Video Cut Release With Governance',
    `action: ${report.action}`,
    `target: ${report.target}`,
    `status: ${report.status}`,
    '',
    ...report.governanceReports.map((item) => `${item.status.toUpperCase()} ${item.command}: ${item.reportPath}`),
    report.releaseContracts
      ? `${report.releaseContracts.status.toUpperCase()} ${report.releaseContracts.command}: ${report.releaseContracts.reportPath}`
      : '',
    report.signatureVerification
      ? `${report.signatureVerification.status.toUpperCase()} ${report.signatureVerification.command}: ${report.signatureVerification.reportPath}`
      : '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

async function main() {
  try {
    const options = parseReleaseWithGovernanceArgs(process.argv.slice(2));
    const report = await createReleaseWithGovernanceReport(options);
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
          status: 'fail',
          error: {
            code: 'RELEASE_WITH_GOVERNANCE_FAILED',
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
