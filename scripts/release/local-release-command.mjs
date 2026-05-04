#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

import { normalizeCliArgs } from '../lib/cli-args.mjs';
import { findLocalAbsolutePath, reportContainsSensitiveData } from '../lib/report-safety.mjs';

const REPORT_VERSION = 'video-cut.local-release-command.v1';
const GOVERNANCE_EVIDENCE_BUNDLE_VERSION = 'video-cut.governance-evidence-bundle.v1';
const DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
export const SMOKE_EVIDENCE_BUNDLE_VERSION = 'video-cut.smoke-evidence-bundle.v1';
export const PROVENANCE_VERSION = 'video-cut.release-provenance.v1';
export const RELEASE_SIGNATURE_VERSION = 'video-cut.release-signature.v1';
const TARGETS = new Set(['desktop', 'server', 'web', 'container', 'kubernetes']);
const ACTIONS = new Set(['package', 'smoke']);
const CONTRACT_VERSIONS = {
  api: 'openapi.video-cut.v1',
  schema: 'video-cut.schema-bundle.v1',
  provider: 'video-cut.provider-capability.schema.v1',
  runtimeProfile: 'video-cut.runtime-profile.v1',
};

const TARGET_REQUIREMENTS = {
  desktop: ['deploy/runtime-profiles.yaml', 'host/Cargo.toml', 'host/src/main.rs', 'package.json', 'dist/index.html', '.env.example'],
  server: ['deploy/runtime-profiles.yaml', 'host/Cargo.toml', 'host/src/main.rs', 'docs/openapi/video-cut-v1.yaml'],
  web: ['deploy/runtime-profiles.yaml', 'package.json', 'src/App.tsx', 'dist/index.html'],
  container: ['deploy/runtime-profiles.yaml', 'deploy/docker/Dockerfile', 'deploy/docker/docker-compose.yml', 'deploy/docker/nginx.conf'],
  kubernetes: [
    'deploy/runtime-profiles.yaml',
    'deploy/kubernetes/Chart.yaml',
    'deploy/kubernetes/values.yaml',
    'deploy/kubernetes/templates/deployment.yaml',
  ],
};
const SMOKE_REPORT_VERSIONS = {
  desktop: new Set(['video-cut.http-workflow-smoke.v1']),
  server: new Set(['video-cut.managed-server-workflow-smoke.v1']),
  web: new Set(['video-cut.managed-ui-workflow-smoke.v1']),
  container: new Set(['video-cut.http-workflow-smoke.v1']),
  kubernetes: new Set(['video-cut.http-workflow-smoke.v1']),
};
const EXPECTED_SMOKE_DEPLOYMENT_MODES = {
  desktop: 'desktop-local',
  server: 'server-private',
  container: 'container-private',
  kubernetes: 'kubernetes-private',
};
const REQUIRED_HTTP_WORKFLOW_CHECKS = [
  'health',
  'taskCreate',
  'sourceUpload',
  'analysis',
  'planRoundtrip',
  'render',
  'artifactList',
  'artifactDownloadDescriptors',
  'artifactContent',
  'artifactRangeContent',
  'artifactSecurityHeaders',
  'events',
  'redaction',
];
const REQUIRED_MANAGED_SERVER_CHECKS = [
  'hostBuild',
  'hostStart',
  'hostHealth',
  'workflowSmoke',
  'processCleanup',
  'redaction',
];
const REQUIRED_GOVERNANCE_REPORTS = [
  {
    id: 'cli-contracts',
    fileName: 'cli-contracts-report.json',
    reportVersion: 'video-cut.cli-contracts-report.v1',
    command: 'check:cli-contracts',
  },
  {
    id: 'database-contracts',
    fileName: 'database-contracts-report.json',
    reportVersion: 'video-cut.database-contracts-report.v1',
    command: 'check:database-contracts',
  },
  {
    id: 'deployment-artifacts',
    fileName: 'deployment-artifacts-report.json',
    reportVersion: 'video-cut.deployment-artifacts-report.v1',
    command: 'check:deployment-artifacts',
  },
  {
    id: 'deployment-matrix',
    fileName: 'deployment-matrix-report.json',
    reportVersion: 'video-cut.deployment-matrix.v1',
    command: 'check:deployment-matrix',
  },
  {
    id: 'openapi-contracts',
    fileName: 'openapi-contracts-report.json',
    reportVersion: 'video-cut.openapi-contracts-report.v1',
    command: 'check:contracts',
  },
  {
    id: 'smoke-evidence-contracts',
    fileName: 'smoke-evidence-contracts-report.json',
    reportVersion: 'video-cut.smoke-evidence-contracts-report.v1',
    command: 'check:smoke-evidence',
  },
  {
    id: 'feature-readiness',
    fileName: 'feature-readiness-report.json',
    reportVersion: 'video-cut.feature-readiness-report.v1',
    command: 'check:feature-readiness',
  },
  {
    id: 'feature-readiness-policy',
    fileName: 'feature-readiness-policy-report.json',
    reportVersion: 'video-cut.feature-readiness-policy-report.v1',
    command: 'check:feature-readiness-policy',
  },
  {
    id: 'governance-suite',
    fileName: 'governance-suite-report.json',
    reportVersion: 'video-cut.governance-suite.v1',
    command: 'check:governance',
  },
];
const GENERATED_RELEASE_ROOT_FILES = new Set([
  'release-manifest.json',
  'quality-gate-execution-report.json',
  'SHA256SUMS.txt',
  'release-notes.md',
  'governance-evidence-bundle.json',
  'smoke-evidence-bundle.json',
  'provenance.json',
  'release-signature.json',
  'sdkwork-video-cut-sbom.cdx.json',
]);
const GENERATED_RELEASE_FILE_PATTERNS = [
  /(^|\/)release-manifest\.json$/,
  /(^|\/)quality-gate-execution-report\.json$/,
  /(^|\/)SHA256SUMS\.txt$/,
  /(^|\/)release-notes\.md$/,
  /(^|\/)governance-evidence-bundle\.json$/,
  /(^|\/)smoke-evidence-bundle\.json$/,
  /(^|\/)provenance\.json$/,
  /(^|\/)release-signature\.json$/,
  /(^|\/)sdkwork-video-cut-sbom\.cdx\.json$/,
  /(^|\/)[^/]+-(package|smoke)-report\.json$/,
  /(^|\/)smoke\/[^/]+-smoke[^/]*-report\.json$/,
  /(^|\/)artifacts\/governance\/.*-report\.json$/,
];

export function parseReleaseArgs(argv) {
  const args = normalizeCliArgs(argv);
  const action = args.shift();
  const target = args.shift();
  let releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR;
  let reportDir = DEFAULT_REPORT_DIR;
  let smokeReportPath = '';
  let json = false;

  if (!ACTIONS.has(action)) {
    throw new Error('Release action must be package or smoke.');
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
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--release-assets-dir requires a value.');
      }
      assertProjectRelativePath('--release-assets-dir', value);
      releaseAssetsDir = value;
      index += 1;
      continue;
    }

    if (arg === '--report-dir') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--report-dir requires a value.');
      }
      assertProjectRelativePath('--report-dir', value);
      reportDir = value;
      index += 1;
      continue;
    }

    if (arg === '--smoke-report') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--smoke-report requires a value.');
      }
      assertProjectRelativePath('--smoke-report', value);
      smokeReportPath = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown release argument: ${arg}`);
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

export function createReleaseCommandReport({
  action,
  projectRoot = process.cwd(),
  releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR,
  reportDir = DEFAULT_REPORT_DIR,
  smokeReportPath = '',
  target,
}) {
  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const normalizedReportDir = normalizeProjectPath(reportDir);
  const governanceReportDefinitions = createGovernanceReportDefinitions(normalizedReportDir);
  const requirements = TARGET_REQUIREMENTS[target] ?? [];
  const requirementArtifacts = requirements.map((path) => createArtifactRecord(projectRoot, path));
  const governanceEvidence = createGovernanceEvidence(projectRoot, governanceReportDefinitions);
  const smokeEvidence = createSmokeEvidence(projectRoot, action, target, smokeReportPath);
  const artifacts = [...requirementArtifacts, ...governanceEvidence.artifacts, ...smokeEvidence.artifacts];
  const checks = requirementArtifacts.map((artifact) => {
    return {
      id: `${target}-${artifact.path.replace(/[\\/\.]/g, '-')}`,
      status: artifact.exists ? 'pass' : 'fail',
      evidence: artifact.path,
    };
  }).concat(governanceEvidence.checks, smokeEvidence.checks);
  const summary = summarizeChecks(checks);
  const actionReportPath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/${target}-${action}-report.json`);
  const releaseFiles = writeStandardReleaseFiles({
    action,
    actionReportPath,
    artifacts,
    checks,
    governanceReportDefinitions,
    projectRoot,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    smokeReportPath,
    summary,
    target,
  });
  const report = {
    reportVersion: REPORT_VERSION,
    action,
    target,
    status: summary.fail === 0 ? 'pass' : 'fail',
    generatedAt: new Date().toISOString(),
    releaseAssetsDir: normalizedReleaseAssetsDir,
    reportDir: normalizedReportDir,
    summary,
    checks,
    actionReportPath,
    ...releaseFiles,
  };

  writeReleaseReport(resolve(projectRoot, actionReportPath), report);
  return sealReleaseProvenance({
    projectRoot,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    report,
  });
}

function createGovernanceReportDefinitions(reportDir = DEFAULT_REPORT_DIR) {
  const normalizedReportDir = normalizeProjectPath(reportDir);
  return REQUIRED_GOVERNANCE_REPORTS.map((definition) => ({
    ...definition,
    path: `${normalizedReportDir}/${definition.fileName}`,
  }));
}

function createGovernanceEvidence(projectRoot, governanceReportDefinitions) {
  const artifacts = [];
  const checks = [];

  for (const definition of governanceReportDefinitions) {
    const artifact = createArtifactRecord(projectRoot, definition.path);
    if (artifact.exists) {
      artifacts.push(artifact);
    }

    const validation = artifact.exists
      ? validateGovernanceReport(projectRoot, definition)
      : { valid: false, reason: `Required governance report is missing: ${definition.path}.` };

    checks.push({
      id: `governance-evidence-${definition.id}`,
      status: validation.valid ? 'pass' : 'fail',
      evidence: validation.valid ? definition.path : validation.reason,
    });
  }

  return { artifacts, checks };
}

function validateGovernanceReport(projectRoot, definition) {
  let report;
  try {
    report = JSON.parse(readFileSync(resolve(projectRoot, definition.path), 'utf8'));
  } catch (error) {
    return {
      valid: false,
      reason: `Unable to parse governance report JSON ${definition.path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (report?.reportVersion !== definition.reportVersion) {
    return {
      valid: false,
      reason: `${definition.path} must use reportVersion=${definition.reportVersion}.`,
    };
  }

  if (report?.command !== definition.command) {
    return {
      valid: false,
      reason: `${definition.path} must declare command=${definition.command}.`,
    };
  }

  if (report?.status !== 'pass') {
    return {
      valid: false,
      reason: `${definition.path} must have status=pass before release packaging.`,
    };
  }

  if (report?.reportPath !== definition.path) {
    return {
      valid: false,
      reason: `${definition.path} must serialize its standard project-relative reportPath.`,
    };
  }

  if (Number(report?.summary?.fail ?? 0) !== 0) {
    return {
      valid: false,
      reason: `${definition.path} must have summary.fail=0.`,
    };
  }

  if (Number(report?.summary?.blockingFailures ?? 0) !== 0 || Number(report?.summary?.gaps ?? 0) !== 0) {
    return {
      valid: false,
      reason: `${definition.path} must have no feature readiness gaps or blocking failures.`,
    };
  }

  if (reportContainsSensitiveData(report)) {
    return {
      valid: false,
      reason: `${definition.path} contains sensitive fields or credential-shaped values.`,
    };
  }

  const localPathLeak = findLocalAbsolutePath(report);
  if (localPathLeak) {
    return {
      valid: false,
      reason: `${definition.path} contains a server-local absolute path at ${localPathLeak}.`,
    };
  }

  return { valid: true, reason: '' };
}

function createSmokeEvidence(projectRoot, action, target, smokeReportPath) {
  if (action !== 'smoke') {
    return { artifacts: [], checks: [] };
  }

  const checkId = `${target}-smoke-report-evidence`;
  if (!smokeReportPath) {
    return {
      artifacts: [],
      checks: [
        {
          id: checkId,
          status: 'fail',
          evidence: 'release smoke requires --smoke-report evidence.',
        },
      ],
    };
  }

  if (isAbsolute(smokeReportPath)) {
    return {
      artifacts: [],
      checks: [
        {
          id: checkId,
          status: 'fail',
          evidence: 'release smoke report path must be project-relative to avoid leaking local paths.',
        },
      ],
    };
  }

  try {
    assertProjectRelativePath('smokeReportPath', smokeReportPath);
  } catch (error) {
    return {
      artifacts: [],
      checks: [
        {
          id: checkId,
          status: 'fail',
          evidence: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  const artifact = createArtifactRecord(projectRoot, smokeReportPath);
  if (!artifact.exists) {
    return {
      artifacts: [],
      checks: [
        {
          id: checkId,
          status: 'fail',
          evidence: smokeReportPath,
        },
      ],
    };
  }

  const validation = validateSmokeReport(projectRoot, target, smokeReportPath);
  return {
    artifacts: [artifact],
    checks: [
      {
        id: checkId,
        status: validation.valid ? 'pass' : 'fail',
        evidence: validation.valid ? smokeReportPath : validation.reason,
      },
    ],
  };
}

function validateSmokeReport(projectRoot, target, smokeReportPath) {
  let report;
  try {
    report = JSON.parse(readFileSync(resolve(projectRoot, smokeReportPath), 'utf8'));
  } catch (error) {
    return {
      valid: false,
      reason: `Unable to parse smoke report JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return validateSmokeReportObject(target, report);
}

export function validateSmokeReportObject(target, report) {
  const allowedVersions = SMOKE_REPORT_VERSIONS[target] ?? new Set();
  if (!allowedVersions.has(report?.reportVersion)) {
    return {
      valid: false,
      reason: `Smoke report version ${String(report?.reportVersion)} is not valid for ${target}.`,
    };
  }

  if (report?.ok !== true || Number(report?.summary?.fail ?? 1) !== 0) {
    return {
      valid: false,
      reason: 'Smoke report must have ok=true and summary.fail=0.',
    };
  }

  if (reportContainsSensitiveData(report)) {
    return {
      valid: false,
      reason: 'Smoke report contains sensitive fields or credential-shaped values.',
    };
  }

  const localPathLeak = findLocalAbsolutePath(report);
  if (localPathLeak) {
    return {
      valid: false,
      reason: `Smoke report contains a server-local absolute path at ${localPathLeak}.`,
    };
  }

  const targetValidation = validateTargetSpecificSmokeReport(target, report);
  if (!targetValidation.valid) {
    return targetValidation;
  }

  return { valid: true, reason: '' };
}

export function createSmokeEvidenceSummary(target, report) {
  if (target === 'web') {
    return createWebSmokeEvidenceSummary(report);
  }

  if (target === 'server') {
    return {
      type: 'managed-server-private-workflow',
      deploymentMode: report?.deploymentMode ?? '',
      runtime: {
        authMode: valueAtPath(report, 'runtime.authMode') ?? '',
      },
      managedChecks: Object.fromEntries(
        REQUIRED_MANAGED_SERVER_CHECKS.map((checkId) => [checkId, hasOkCheck(report, checkId)]),
      ),
      workflow: createHttpWorkflowSmokeEvidenceSummary('server', valueAtPath(report, 'workflow'), {
        requireDeploymentMode: false,
      }),
    };
  }

  return createHttpWorkflowSmokeEvidenceSummary(target, report);
}

function createWebSmokeEvidenceSummary(report) {
  const requiredTrueFields = [
    'ui.artifactContentAuthorizationVerified',
    'ui.artifactContentEndpointFetched',
    'ui.artifactDownloadAuthorizationVerified',
    'ui.artifactDownloadButtonVisible',
    'ui.artifactDownloadContentFetched',
    'ui.deliveryPackageVisible',
    'ui.diagnosticsBundleVerified',
    'ui.doctorVerified',
    'ui.manifestVisible',
    'ui.outputArtifactVisible',
    'ui.outputPreviewBlobUrl',
    'ui.providerConformanceVerified',
    'ui.resultsPageVerified',
    'ui.settingsRedactionVerified',
    'ui.settingsSaved',
  ];

  return {
    type: 'managed-ui-private-browser-delivery',
    requiredUiFields: Object.fromEntries(requiredTrueFields.map((field) => [field, valueAtPath(report, field) === true])),
    localPathLeakVisible: valueAtPath(report, 'ui.localPathLeakVisible') ?? null,
  };
}

function createHttpWorkflowSmokeEvidenceSummary(target, report, { requireDeploymentMode = true } = {}) {
  return {
    type: 'http-workflow-private-artifact-delivery',
    ...(requireDeploymentMode ? { deploymentMode: report?.deploymentMode ?? '' } : {}),
    expectedDeploymentMode: requireDeploymentMode ? EXPECTED_SMOKE_DEPLOYMENT_MODES[target] ?? '' : '',
    taskId: typeof report?.taskId === 'string' ? report.taskId : '',
    requiredChecks: Object.fromEntries(REQUIRED_HTTP_WORKFLOW_CHECKS.map((checkId) => [checkId, hasOkCheck(report, checkId)])),
    source: {
      sizeBytes: Number(valueAtPath(report, 'source.sizeBytes') ?? 0),
    },
    artifacts: {
      output: {
        downloadMode: valueAtPath(report, 'artifacts.output.downloadMode') ?? '',
        bytesChecked: Number(valueAtPath(report, 'artifacts.output.bytesChecked') ?? 0),
        mp4Signature: valueAtPath(report, 'artifacts.output.mp4Signature') === true,
        rangeChecked: valueAtPath(report, 'artifacts.output.rangeChecked') === true,
        rangeBytesChecked: Number(valueAtPath(report, 'artifacts.output.rangeBytesChecked') ?? 0),
        securityHeadersChecked: valueAtPath(report, 'artifacts.output.securityHeadersChecked') === true,
      },
      manifest: {
        downloadMode: valueAtPath(report, 'artifacts.manifest.downloadMode') ?? '',
      },
      log: {
        downloadMode: valueAtPath(report, 'artifacts.log.downloadMode') ?? '',
      },
    },
  };
}

function validateTargetSpecificSmokeReport(target, report) {
  if (target === 'web') {
    return validateWebSmokeReport(report);
  }

  if (target === 'server') {
    return validateManagedServerSmokeReport(report);
  }

  if (target === 'desktop' || target === 'container' || target === 'kubernetes') {
    return validateHttpWorkflowSmokeReport(target, report);
  }

  return { valid: true, reason: '' };
}

function validateWebSmokeReport(report) {
  const requiredTrueFields = [
    'ui.artifactContentAuthorizationVerified',
    'ui.artifactContentEndpointFetched',
    'ui.artifactDownloadAuthorizationVerified',
    'ui.artifactDownloadButtonVisible',
    'ui.artifactDownloadContentFetched',
    'ui.deliveryPackageVisible',
    'ui.diagnosticsBundleVerified',
    'ui.doctorVerified',
    'ui.manifestVisible',
    'ui.outputArtifactVisible',
    'ui.outputPreviewBlobUrl',
    'ui.providerConformanceVerified',
    'ui.resultsPageVerified',
    'ui.settingsRedactionVerified',
    'ui.settingsSaved',
  ];
  const missingTrueFields = requiredTrueFields.filter((field) => valueAtPath(report, field) !== true);
  const failedFields = [
    ...missingTrueFields,
    ...(valueAtPath(report, 'ui.localPathLeakVisible') === false ? [] : ['ui.localPathLeakVisible=false']),
  ];

  if (failedFields.length > 0) {
    return {
      valid: false,
      reason: `Web smoke report is missing required private browser delivery evidence: ${failedFields.join(', ')}.`,
    };
  }

  return { valid: true, reason: '' };
}

function validateManagedServerSmokeReport(report) {
  const failedFields = [];
  const expectedDeploymentMode = EXPECTED_SMOKE_DEPLOYMENT_MODES.server;

  if (report?.deploymentMode !== expectedDeploymentMode) {
    failedFields.push(`deploymentMode=${expectedDeploymentMode}`);
  }
  if (valueAtPath(report, 'runtime.authMode') !== 'single-user-token') {
    failedFields.push('runtime.authMode=single-user-token');
  }
  if (valueAtPath(report, 'workflow.ok') !== true) {
    failedFields.push('workflow.ok');
  }
  if (valueAtPath(report, 'workflow.reportVersion') !== 'video-cut.http-workflow-smoke.v1') {
    failedFields.push('workflow.reportVersion=video-cut.http-workflow-smoke.v1');
  }
  if (Number(valueAtPath(report, 'workflow.summary.fail') ?? 1) !== 0) {
    failedFields.push('workflow.summary.fail=0');
  }

  const missingManagedChecks = REQUIRED_MANAGED_SERVER_CHECKS.filter((checkId) => !hasOkCheck(report, checkId));
  failedFields.push(...missingManagedChecks);

  const workflowValidation = validateHttpWorkflowSmokeReport('server', valueAtPath(report, 'workflow'), {
    checkPrefix: 'workflow.',
    requireDeploymentMode: false,
  });
  if (!workflowValidation.valid) {
    failedFields.push(workflowValidation.reason.replace(/^HTTP workflow smoke report is missing required evidence: /, 'workflow.'));
  }

  if (failedFields.length > 0) {
    return {
      valid: false,
      reason: `Server smoke report is missing required managed server evidence: ${failedFields.join(', ')}.`,
    };
  }

  return { valid: true, reason: '' };
}

function validateHttpWorkflowSmokeReport(target, report, { checkPrefix = '', requireDeploymentMode = true } = {}) {
  const failedFields = [];
  const expectedDeploymentMode = EXPECTED_SMOKE_DEPLOYMENT_MODES[target];

  if (requireDeploymentMode && expectedDeploymentMode && report?.deploymentMode !== expectedDeploymentMode) {
    failedFields.push(`deploymentMode=${expectedDeploymentMode}`);
  }
  if (typeof report?.taskId !== 'string' || report.taskId.trim().length === 0) {
    failedFields.push(`${checkPrefix}taskId`);
  }

  const missingWorkflowChecks = REQUIRED_HTTP_WORKFLOW_CHECKS.filter((checkId) => !hasOkCheck(report, checkId));
  failedFields.push(...missingWorkflowChecks.map((checkId) => `${checkPrefix}${checkId}`));

  const artifactEvidence = [
    ['artifacts.output.downloadMode', 'host-content-endpoint'],
    ['artifacts.manifest.downloadMode', 'host-content-endpoint'],
    ['artifacts.log.downloadMode', 'host-content-endpoint'],
  ];
  for (const [field, expected] of artifactEvidence) {
    if (valueAtPath(report, field) !== expected) {
      failedFields.push(`${checkPrefix}${field}=${expected}`);
    }
  }
  if (Number(valueAtPath(report, 'artifacts.output.bytesChecked') ?? 0) <= 0) {
    failedFields.push(`${checkPrefix}artifacts.output.bytesChecked`);
  }
  if (valueAtPath(report, 'artifacts.output.mp4Signature') !== true) {
    failedFields.push(`${checkPrefix}artifacts.output.mp4Signature`);
  }
  if (valueAtPath(report, 'artifacts.output.rangeChecked') !== true) {
    failedFields.push(`${checkPrefix}artifacts.output.rangeChecked`);
  }
  if (Number(valueAtPath(report, 'artifacts.output.rangeBytesChecked') ?? 0) <= 0) {
    failedFields.push(`${checkPrefix}artifacts.output.rangeBytesChecked`);
  }
  if (valueAtPath(report, 'artifacts.output.securityHeadersChecked') !== true) {
    failedFields.push(`${checkPrefix}artifacts.output.securityHeadersChecked`);
  }
  if (Number(valueAtPath(report, 'source.sizeBytes') ?? 0) <= 0) {
    failedFields.push(`${checkPrefix}source.sizeBytes`);
  }

  if (failedFields.length > 0) {
    return {
      valid: false,
      reason: `HTTP workflow smoke report is missing required evidence: ${failedFields.join(', ')}.`,
    };
  }

  return { valid: true, reason: '' };
}

function hasOkCheck(report, checkId) {
  return Array.isArray(report?.checks) && report.checks.some((check) => check?.checkId === checkId && check?.status === 'ok');
}

function valueAtPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function assertProjectRelativePath(name, value) {
  const normalized = normalizeProjectPath(value);
  if (isAbsolute(String(value || '')) || normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) {
    throw new Error(`${name} must be project-relative and must not contain parent-directory segments.`);
  }
}

function normalizeProjectPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function summarizeChecks(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, fail: 0 },
  );
}

function writeReleaseReport(outputPath, report) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function sealReleaseProvenance({ projectRoot, releaseAssetsDir, report }) {
  const releaseRoot = resolve(projectRoot, releaseAssetsDir);
  const manifestPath = resolve(releaseRoot, 'release-manifest.json');
  const checksumsPath = resolve(releaseRoot, 'SHA256SUMS.txt');
  const provenancePath = resolve(releaseRoot, 'provenance.json');
  const signaturePath = resolve(releaseRoot, 'release-signature.json');
  const actionReportKey = `${report.target}-${report.action}-report.json`;

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  provenance.standardArtifacts[actionReportKey] = artifactProofFromProjectPath(projectRoot, report.actionReportPath);
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');

  const provenanceArtifact = createArtifactRecordFromBytes('provenance.json', readFileSync(provenancePath));
  manifest.artifacts = manifest.artifacts.map((artifact) => {
    return artifact.path === 'provenance.json' ? provenanceArtifact : artifact;
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  writeChecksumsFile(checksumsPath, manifest.artifacts);

  const signature = createReleaseSignature({
    actionReportPath: report.actionReportPath,
    manifest,
    manifestPath: `${releaseAssetsDir}/release-manifest.json`,
    projectRoot,
    provenancePath: `${releaseAssetsDir}/provenance.json`,
    qualityGateReportPath: report.qualityGateReportPath,
    releaseAssetsDir,
    releaseRoot,
  });
  writeFileSync(signaturePath, `${JSON.stringify(signature, null, 2)}\n`, 'utf8');

  const signatureArtifact = createArtifactRecordFromBytes('release-signature.json', readFileSync(signaturePath));
  manifest.artifacts = [
    ...manifest.artifacts.filter((artifact) => artifact.path !== 'release-signature.json'),
    signatureArtifact,
  ];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeChecksumsFile(checksumsPath, manifest.artifacts);

  return {
    ...report,
    signaturePath: `${releaseAssetsDir}/release-signature.json`,
  };
}

function createReleaseSignature({
  actionReportPath,
  manifest,
  manifestPath,
  projectRoot,
  provenancePath,
  qualityGateReportPath,
  releaseAssetsDir,
}) {
  const subjectArtifacts = manifest.artifacts.filter((artifact) => artifact.path !== 'release-signature.json');
  const manifestSubject = createReleaseManifestSignatureSubject(manifest, subjectArtifacts);
  const checksumsSubject = checksumsTextForArtifacts(subjectArtifacts);
  const signedFiles = [
    bytesSignatureSubject(
      Buffer.from(JSON.stringify(manifestSubject), 'utf8'),
      manifestPath,
      'release-manifest-subject',
    ),
    bytesSignatureSubject(
      Buffer.from(checksumsSubject, 'utf8'),
      `${releaseAssetsDir}/SHA256SUMS.txt`,
      'sha256sums-subject',
    ),
    fileSignatureSubject(projectRoot, provenancePath, 'provenance'),
    fileSignatureSubject(projectRoot, `${releaseAssetsDir}/release-notes.md`, 'release-notes'),
    fileSignatureSubject(projectRoot, qualityGateReportPath, 'quality-gate-report'),
    fileSignatureSubject(projectRoot, actionReportPath, 'action-report'),
  ];
  const payload = {
    algorithm: 'sha256',
    subjectManifestSha256: hashJsonStable(subjectArtifacts),
    signedFiles,
  };

  return {
    signatureVersion: RELEASE_SIGNATURE_VERSION,
    product: 'sdkwork-video-cut',
    action: manifest.action,
    target: manifest.target,
    status: manifest.status,
    generatedAt: new Date().toISOString(),
    releaseAssetsDir,
    signatureKind: 'local-deterministic-digest',
    payload,
    signature: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    verification: {
      command: 'check:release-contracts',
      contract: 'release-signature-contract',
    },
    notes:
      'Local deterministic digest for offline release integrity. Manifest and SHA256SUMS subjects intentionally exclude release-signature.json to avoid self-referential hashes. External key signing can wrap this payload without changing the release contract.',
  };
}

function createReleaseManifestSignatureSubject(manifest, subjectArtifacts) {
  return {
    manifestVersion: manifest.manifestVersion,
    product: manifest.product,
    action: manifest.action,
    target: manifest.target,
    runtimeProfile: manifest.runtimeProfile,
    contractVersions: manifest.contractVersions,
    status: manifest.status,
    generatedAt: manifest.generatedAt,
    artifacts: subjectArtifacts,
  };
}

function fileSignatureSubject(projectRoot, path, role) {
  const normalizedPath = normalizeProjectPath(path);
  const bytes = readFileSync(resolve(projectRoot, normalizedPath));
  return bytesSignatureSubject(bytes, normalizedPath, role);
}

function bytesSignatureSubject(bytes, path, role) {
  return {
    role,
    path: normalizeProjectPath(path),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}

function writeChecksumsFile(path, artifacts) {
  const checksums = checksumsTextForArtifacts(artifacts);
  writeFileSync(path, `${checksums}${checksums ? '\n' : ''}`, 'utf8');
}

function checksumsTextForArtifacts(artifacts) {
  return artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join('\n');
}

function writeStandardReleaseFiles({
  action,
  actionReportPath,
  artifacts,
  checks,
  governanceReportDefinitions,
  projectRoot,
  releaseAssetsDir,
  smokeReportPath,
  summary,
  target,
}) {
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const releaseRoot = resolve(projectRoot, normalizedReleaseAssetsDir);
  mkdirSync(releaseRoot, { recursive: true });
  prepareReleaseAssetsDirectory({
    projectRoot,
    protectedPaths: [smokeReportPath].filter(Boolean),
    releaseAssetsDir: normalizedReleaseAssetsDir,
  });
  const generatedAt = new Date().toISOString();
  const status = summary.fail === 0 ? 'pass' : 'fail';
  const existingArtifacts = artifacts.filter((artifact) => artifact.exists);
  const runtimeProfile = runtimeProfileForTarget(projectRoot, target);

  const manifestPath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/release-manifest.json`);
  const checksumsPath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/SHA256SUMS.txt`);
  const releaseNotesPath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/release-notes.md`);
  const qualityGateReportPath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/quality-gate-execution-report.json`);
  const provenancePath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/provenance.json`);
  const signaturePath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/release-signature.json`);
  const absoluteManifestPath = resolve(projectRoot, manifestPath);
  const absoluteChecksumsPath = resolve(projectRoot, checksumsPath);
  const absoluteReleaseNotesPath = resolve(projectRoot, releaseNotesPath);
  const absoluteQualityGateReportPath = resolve(projectRoot, qualityGateReportPath);
  const absoluteProvenancePath = resolve(projectRoot, provenancePath);

  writeFileSync(
    absoluteReleaseNotesPath,
    createReleaseNotesText({
      action,
      contractVersions: CONTRACT_VERSIONS,
      generatedAt,
      status,
      summary,
      target,
    }),
    'utf8',
  );

  const releaseArtifactRecords = buildReleaseArtifactRecords({
    action,
    existingArtifacts,
    generatedAt,
    governanceReportDefinitions,
    projectRoot,
    releaseRoot,
    smokeReportPath,
    status,
    target,
  });
  const releaseNotesArtifact = createArtifactRecordFromBytes('release-notes.md', readFileSync(absoluteReleaseNotesPath));
  const provenanceSubjectArtifacts = [
    ...releaseArtifactRecords.map(({ exists, absolutePath, ...artifact }) => artifact),
    releaseNotesArtifact,
  ];
  const qualityReport = {
    gateVersion: 'video-cut.quality-gate-report.v1',
    action,
    target,
    runtimeProfile,
    contractVersions: CONTRACT_VERSIONS,
    status,
    generatedAt,
    summary,
    checks,
  };
  writeFileSync(absoluteQualityGateReportPath, `${JSON.stringify(qualityReport, null, 2)}\n`, 'utf8');
  const provenance = createReleaseProvenance({
    action,
    actionReportPath,
    artifacts: provenanceSubjectArtifacts,
    generatedAt,
    projectRoot,
    qualityGateReportPath,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    releaseRoot,
    status,
    target,
  });
  writeFileSync(absoluteProvenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  const provenanceArtifact = createArtifactRecordFromBytes('provenance.json', readFileSync(absoluteProvenancePath));
  const manifest = {
    manifestVersion: 'video-cut.release-manifest.v1',
    product: 'sdkwork-video-cut',
    action,
    target,
    runtimeProfile,
    contractVersions: CONTRACT_VERSIONS,
    status,
    generatedAt,
    artifacts: [
      ...provenanceSubjectArtifacts,
      provenanceArtifact,
    ],
  };
  const releaseArtifacts = manifest.artifacts;

  writeFileSync(absoluteManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeChecksumsFile(absoluteChecksumsPath, releaseArtifacts);
  return {
    checksumsPath,
    manifestPath,
    provenancePath,
    qualityGateReportPath,
    releaseNotesPath,
    signaturePath,
  };
}

function createReleaseNotesText({ action, contractVersions, generatedAt, status, summary, target }) {
  return [
    `# sdkwork-video-cut ${target} ${action}`,
    '',
    `- status: ${status}`,
    `- generatedAt: ${generatedAt}`,
    `- failedChecks: ${summary.fail}`,
    `- apiContract: ${contractVersions.api}`,
    `- schemaContract: ${contractVersions.schema}`,
    `- providerContract: ${contractVersions.provider}`,
    `- runtimeProfileContract: ${contractVersions.runtimeProfile}`,
    '',
  ].join('\n');
}

function prepareReleaseAssetsDirectory({ projectRoot, protectedPaths = [], releaseAssetsDir }) {
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const releaseRoot = resolve(projectRoot, normalizedReleaseAssetsDir);
  if (!existsSync(releaseRoot)) {
    return;
  }

  const protectedProjectPaths = new Set(protectedPaths.map((path) => normalizeProjectPath(path)));
  for (const absolutePath of listGeneratedReleaseFiles(releaseRoot)) {
    const releaseRelativePath = normalizeProjectPath(relative(releaseRoot, absolutePath));
    const projectPath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/${releaseRelativePath}`);
    if (protectedProjectPaths.has(projectPath)) {
      continue;
    }
    assertPathInsideReleaseRoot(releaseRoot, absolutePath);
    rmSync(absolutePath, { force: true });
  }
}

function listGeneratedReleaseFiles(releaseRoot) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const releaseRelativePath = normalizeProjectPath(relative(releaseRoot, absolutePath));
      const isGeneratedRootFile = !releaseRelativePath.includes('/') && GENERATED_RELEASE_ROOT_FILES.has(entry.name);
      const isGeneratedReleaseFile = GENERATED_RELEASE_FILE_PATTERNS.some((pattern) => pattern.test(releaseRelativePath));
      if (isGeneratedRootFile || isGeneratedReleaseFile) {
        files.push(absolutePath);
      }
    }
  };

  visit(releaseRoot);
  return files;
}

function createReleaseProvenance({
  action,
  actionReportPath,
  artifacts,
  generatedAt,
  projectRoot,
  qualityGateReportPath,
  releaseAssetsDir,
  releaseRoot,
  status,
  target,
}) {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
  const artifactManifestSha256 = hashJsonStable(artifacts);
  const standardArtifacts = Object.fromEntries(
    [
      'governance-evidence-bundle.json',
      ...(action === 'smoke' ? ['smoke-evidence-bundle.json'] : []),
      'sdkwork-video-cut-sbom.cdx.json',
      'release-notes.md',
    ].map((artifactPath) => [artifactPath, artifactProofFromReleaseRoot(releaseRoot, artifactPath)]),
  );

  return {
    provenanceVersion: PROVENANCE_VERSION,
    product: 'sdkwork-video-cut',
    action,
    target,
    status,
    generatedAt,
    releaseAssetsDir,
    package: {
      name: packageJson.name ?? '',
      version: packageJson.version ?? '',
      packageManager: packageJson.packageManager ?? '',
    },
    buildEnvironment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    git: readGitProvenance(projectRoot),
    subject: {
      artifactCount: artifacts.length,
      artifactManifestSha256,
      artifacts,
    },
    standardArtifacts: {
      ...standardArtifacts,
      [qualityGateReportPath.replace(`${releaseAssetsDir}/`, '')]: artifactProofFromProjectPath(projectRoot, qualityGateReportPath),
      [actionReportPath.replace(`${releaseAssetsDir}/`, '')]: {
        path: actionReportPath,
        sha256: '',
        sizeBytes: 0,
      },
    },
  };
}

function artifactProofFromReleaseRoot(releaseRoot, artifactPath) {
  const bytes = readFileSync(resolve(releaseRoot, artifactPath));
  return {
    path: artifactPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}

function artifactProofFromProjectPath(projectRoot, artifactPath) {
  const bytes = readFileSync(resolve(projectRoot, artifactPath));
  return {
    path: artifactPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}

function hashJsonStable(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function readGitProvenance(projectRoot) {
  const commit = readGitText(projectRoot, ['rev-parse', 'HEAD']);
  const branch = readGitText(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = readGitText(projectRoot, ['status', '--short']);
  return {
    available: Boolean(commit),
    commit,
    branch,
    dirty: Boolean(status),
    statusSha256: status ? createHash('sha256').update(status).digest('hex') : '',
  };
}

function readGitText(projectRoot, args) {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function runtimeProfileForTarget(projectRoot, target) {
  const registryPath = resolve(projectRoot, 'deploy/runtime-profiles.yaml');
  if (!existsSync(registryPath)) {
    throw new Error('deploy/runtime-profiles.yaml is required to create release runtime profile evidence.');
  }

  const registry = parse(readFileSync(registryPath, 'utf8'));
  if (!registry || registry.registryVersion !== 'video-cut.runtime-profile-registry.v1') {
    throw new Error('Runtime profile registry version must be video-cut.runtime-profile-registry.v1.');
  }

  const profile = registry.profiles?.find((candidate) => candidate.releaseTarget === target);
  if (!profile) {
    throw new Error(`Runtime profile registry does not define release target: ${target}.`);
  }

  return profile;
}

function buildReleaseArtifactRecords({
  action,
  existingArtifacts,
  generatedAt,
  governanceReportDefinitions,
  projectRoot,
  releaseRoot,
  smokeReportPath,
  status,
  target,
}) {
  const evidenceSnapshots = createReleaseEvidenceSnapshotRecords({
    artifacts: existingArtifacts,
    releaseRoot,
  });
  const governanceEvidenceBundlePath = resolve(releaseRoot, 'governance-evidence-bundle.json');
  writeFileSync(
    governanceEvidenceBundlePath,
    `${JSON.stringify(
      createGovernanceEvidenceBundle({
        action,
        generatedAt,
        governanceReportDefinitions,
        projectRoot,
        status,
        target,
      }),
      null,
      2,
    )}\n`,
    'utf8',
  );
  const smokeEvidenceBundlePath = resolve(releaseRoot, 'smoke-evidence-bundle.json');
  if (action === 'smoke') {
    writeFileSync(
      smokeEvidenceBundlePath,
      `${JSON.stringify(
        createSmokeEvidenceBundle({
          action,
          generatedAt,
          projectRoot,
          smokeReportPath,
          status,
          target,
        }),
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
  const sbomPath = resolve(releaseRoot, 'sdkwork-video-cut-sbom.cdx.json');
  writeFileSync(sbomPath, `${JSON.stringify(createCycloneDxSbom(projectRoot), null, 2)}\n`, 'utf8');

  return [
    ...evidenceSnapshots,
    createArtifactRecordFromBytes('governance-evidence-bundle.json', readFileSync(governanceEvidenceBundlePath)),
    ...(action === 'smoke'
      ? [createArtifactRecordFromBytes('smoke-evidence-bundle.json', readFileSync(smokeEvidenceBundlePath))]
      : []),
    createArtifactRecordFromBytes('sdkwork-video-cut-sbom.cdx.json', readFileSync(sbomPath)),
  ];
}

function createReleaseEvidenceSnapshotRecords({ artifacts, releaseRoot }) {
  return artifacts.map((artifact) => {
    const sourcePath = artifact.absolutePath;
    if (!sourcePath) {
      return artifact;
    }

    const snapshotPath = resolve(releaseRoot, normalizeProjectPath(artifact.path));
    assertPathInsideReleaseRoot(releaseRoot, snapshotPath);
    const bytes = readFileSync(sourcePath);
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, bytes);
    return createArtifactRecordFromBytes(artifact.path, bytes, snapshotPath);
  });
}

function assertPathInsideReleaseRoot(releaseRoot, candidatePath) {
  const releaseRelativePath = relative(resolve(releaseRoot), resolve(candidatePath));
  if (
    releaseRelativePath === '..' ||
    releaseRelativePath.startsWith(`..\\`) ||
    releaseRelativePath.startsWith('../') ||
    isAbsolute(releaseRelativePath)
  ) {
    throw new Error('Release evidence snapshot path must stay inside the release assets directory.');
  }
}

function createGovernanceEvidenceBundle({ action, generatedAt, governanceReportDefinitions, projectRoot, status, target }) {
  const reports = governanceReportDefinitions.map((definition) => createGovernanceEvidenceBundleReport(projectRoot, definition));
  const summary = reports.reduce(
    (current, report) => {
      current.total += 1;
      current[report.status === 'pass' ? 'pass' : 'fail'] += 1;
      return current;
    },
    { total: 0, pass: 0, fail: 0 },
  );

  return {
    bundleVersion: GOVERNANCE_EVIDENCE_BUNDLE_VERSION,
    product: 'sdkwork-video-cut',
    action,
    target,
    status,
    generatedAt,
    summary,
    reports,
  };
}

function createGovernanceEvidenceBundleReport(projectRoot, definition) {
  const absolutePath = resolve(projectRoot, definition.path);
  if (!existsSync(absolutePath)) {
    return {
      id: definition.id,
      path: definition.path,
      command: definition.command,
      reportVersion: definition.reportVersion,
      reportPath: '',
      status: 'missing',
      summary: {},
      sha256: '',
      sizeBytes: 0,
      report: null,
    };
  }

  const bytes = readFileSync(absolutePath);
  const report = JSON.parse(bytes.toString('utf8'));
  return {
    id: definition.id,
    path: definition.path,
    command: definition.command,
    reportVersion: definition.reportVersion,
    reportPath: report.reportPath ?? '',
    status: report.status ?? 'unknown',
    summary: report.summary ?? {},
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    report,
  };
}

function createSmokeEvidenceBundle({ action, generatedAt, projectRoot, smokeReportPath, status, target }) {
  const smokeReportArtifact = smokeReportPath ? createArtifactRecord(projectRoot, smokeReportPath) : { exists: false, path: '' };
  let report = null;
  let parseError = '';
  if (smokeReportArtifact.exists) {
    try {
      report = JSON.parse(readFileSync(resolve(projectRoot, smokeReportPath), 'utf8'));
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  const validation = report
    ? validateSmokeReportObject(target, report)
    : { valid: false, reason: parseError ? `Unable to parse smoke report JSON: ${parseError}` : 'Smoke report is missing.' };

  return {
    bundleVersion: SMOKE_EVIDENCE_BUNDLE_VERSION,
    product: 'sdkwork-video-cut',
    action,
    target,
    status,
    generatedAt,
    smokeReportPath: smokeReportArtifact.path,
    reportVersion: report?.reportVersion ?? '',
    ok: report?.ok ?? false,
    deploymentMode: report?.deploymentMode ?? valueAtPath(report, 'workflow.deploymentMode') ?? '',
    summary: report?.summary ?? {},
    validation: {
      status: validation.valid ? 'pass' : 'fail',
      reason: validation.reason,
    },
    sha256: smokeReportArtifact.exists ? smokeReportArtifact.sha256 : '',
    sizeBytes: smokeReportArtifact.exists ? smokeReportArtifact.sizeBytes : 0,
    evidence: report ? createSmokeEvidenceSummary(target, report) : {},
    report,
  };
}

function createArtifactRecord(projectRoot, path) {
  const absolutePath = resolve(projectRoot, path);
  if (!existsSync(absolutePath)) {
    return {
      exists: false,
      path,
    };
  }

  const bytes = readFileSync(absolutePath);
  return createArtifactRecordFromBytes(path, bytes, absolutePath);
}

function createArtifactRecordFromBytes(path, bytes, absolutePath) {
  return {
    exists: true,
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    ...(absolutePath ? { absolutePath } : {}),
  };
}

function createCycloneDxSbom(projectRoot) {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
  const cargoToml = readFileSync(resolve(projectRoot, 'host/Cargo.toml'), 'utf8');
  const components = [
    ...packageComponents(packageJson.dependencies ?? {}),
    ...packageComponents(packageJson.devDependencies ?? {}),
    ...cargoComponents(cargoToml),
  ].sort((left, right) => `${left.group ?? ''}/${left.name}`.localeCompare(`${right.group ?? ''}/${right.name}`));
  const hash = createHash('sha256').update(JSON.stringify(components)).digest('hex').slice(0, 32);

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(
      16,
      20,
    )}-${hash.slice(20)}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        type: 'application',
        name: packageJson.name,
        version: packageJson.version,
      },
    },
    components,
  };
}

function packageComponents(dependencies) {
  return Object.entries(dependencies).map(([name, version]) => ({
    type: 'library',
    name,
    version: String(version),
    purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(String(version))}`,
  }));
}

function cargoComponents(cargoToml) {
  const components = [];
  let section = '';
  for (const rawLine of cargoToml.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== 'dependencies' && section !== 'dev-dependencies') {
      continue;
    }
    const dependencyMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!dependencyMatch) {
      continue;
    }

    const [, name, value] = dependencyMatch;
    const version = value.match(/version\s*=\s*"([^"]+)"/)?.[1] ?? value.match(/"([^"]+)"/)?.[1] ?? 'workspace';
    components.push({
      type: 'library',
      name,
      version,
      purl: `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
    });
  }
  return components;
}

function printHumanReport(report) {
  process.stdout.write(
    [
      `SDKWork Video Cut Local Release Command`,
      `action: ${report.action}`,
      `target: ${report.target}`,
      `status: ${report.status}`,
      `summary: ${report.summary.pass} pass, ${report.summary.fail} fail`,
      '',
      ...report.checks.map((check) => `${check.status.toUpperCase()} ${check.id}: ${check.evidence}`),
    ].join('\n') + '\n',
  );
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

async function main() {
  try {
    const options = parseReleaseArgs(process.argv.slice(2));
    const report = createReleaseCommandReport(options);
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
            code: 'LOCAL_RELEASE_COMMAND_FAILED',
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
