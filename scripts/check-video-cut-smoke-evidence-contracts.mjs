#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { normalizeCliArgs } from './lib/cli-args.mjs';
import { createReportPath } from './lib/report-paths.mjs';

const COMMAND = 'check:smoke-evidence';
const REPORT_VERSION = 'video-cut.smoke-evidence-contracts-report.v1';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const STANDARD_SMOKE_REPORTS = [
  { target: 'desktop', path: 'artifacts/release/smoke/desktop-smoke-report.json' },
  { target: 'server', path: 'artifacts/release/smoke/server-smoke-report.json' },
  { target: 'web', path: 'artifacts/release/smoke/web-smoke-report.json' },
  { target: 'container', path: 'artifacts/release/smoke/container-smoke-report.json' },
  { target: 'kubernetes', path: 'artifacts/release/smoke/kubernetes-smoke-report.json' },
];
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
const REQUIRED_WEB_SMOKE_TRUE_FIELDS = [
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

export function parseSmokeEvidenceContractsArgs(argv) {
  const args = normalizeCliArgs(argv);
  let json = false;
  let reportDir = DEFAULT_REPORT_DIR;
  let smokeReports = [];
  let strict = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--strict') {
      strict = true;
      continue;
    }

    if (arg === '--report-dir') {
      reportDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--smoke-report') {
      smokeReports = [...smokeReports, parseSmokeReportArg(requireValue(args, index, arg))];
      index += 1;
      continue;
    }

    throw new Error(`Unknown smoke evidence contracts argument: ${arg}`);
  }

  return { json, reportDir, smokeReports, strict };
}

export function createSmokeEvidenceContractsReport({
  projectRoot = process.cwd(),
  reportDir = DEFAULT_REPORT_DIR,
  smokeReports = [],
  strict = false,
} = {}) {
  const checks = [
    checkHttpWorkflowSmokeContract(projectRoot),
    checkManagedServerSmokeContract(projectRoot),
    checkManagedUiSmokeContract(projectRoot),
    checkReleaseSmokeScriptsContract(projectRoot),
    checkReleaseSmokeValidationContract(projectRoot),
    ...checkSmokeReportSamples({
      projectRoot,
      smokeReports: smokeReports.length > 0 ? smokeReports : STANDARD_SMOKE_REPORTS,
      strict: strict || smokeReports.length > 0,
    }),
  ];
  const summary = summarizeChecks(checks);
  const { absolutePath, reportPath } = createReportPath(
    projectRoot,
    reportDir,
    'smoke-evidence-contracts-report.json',
  );
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summary.fail === 0 ? 'pass' : 'fail',
    checkedAt: new Date().toISOString(),
    reportPath,
    summary,
    checks,
  };
  writeReport(absolutePath, report);
  return report;
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

if (isDirectRun(import.meta.url)) {
  const options = parseSmokeEvidenceContractsArgs(process.argv.slice(2));
  const report = createSmokeEvidenceContractsReport(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanReport(report);
  }
  process.exitCode = report.status === 'pass' ? 0 : 1;
}

function checkHttpWorkflowSmokeContract(projectRoot) {
  const path = 'scripts/run-video-cut-http-workflow-smoke.mjs';
  const text = readText(projectRoot, path);
  return contractCheck({
    id: 'http-workflow-smoke-contract',
    evidence:
      'HTTP workflow smoke exports a parser/factory and records private artifact content, range, security header, redaction, and download descriptor evidence.',
    validate(errors) {
      requireFile(errors, projectRoot, path);
      requireText(errors, path, text, "REPORT_VERSION = 'video-cut.http-workflow-smoke.v1'");
      requireText(errors, path, text, 'export function parseHttpWorkflowSmokeArgs');
      requireText(errors, path, text, 'export async function createHttpWorkflowSmokeReport');
      requireText(errors, path, text, 'normalizeCliArgs(argv)');
      requireText(errors, path, text, 'artifactDownloadDescriptors');
      requireText(errors, path, text, 'artifactContent');
      requireText(errors, path, text, 'artifactRangeContent');
      requireText(errors, path, text, 'artifactSecurityHeaders');
      requireText(errors, path, text, 'bytesChecked');
      requireText(errors, path, text, 'mp4Signature');
      requireText(errors, path, text, 'rangeBytesChecked');
      requireText(errors, path, text, 'rangeChecked');
      requireText(errors, path, text, 'securityHeadersChecked');
      requireText(errors, path, text, "cacheControl === 'private, no-store'");
      requireText(errors, path, text, "xContentTypeOptions === 'nosniff'");
      requireText(errors, path, text, 'reportContainsSensitiveData');
      requireText(errors, path, text, 'redaction');
      requireText(errors, path, text, '--report-path');
      requireText(errors, path, text, 'downloadMode');
    },
  });
}

function checkManagedServerSmokeContract(projectRoot) {
  const path = 'scripts/run-video-cut-managed-server-smoke.mjs';
  const text = readText(projectRoot, path);
  return contractCheck({
    id: 'managed-server-smoke-contract',
    evidence:
      'Managed server smoke exports a parser/factory, starts a private single-user-token Host, embeds sanitized HTTP workflow evidence, and proves cleanup/redaction.',
    validate(errors) {
      requireFile(errors, projectRoot, path);
      requireText(errors, path, text, "REPORT_VERSION = 'video-cut.managed-server-workflow-smoke.v1'");
      requireText(errors, path, text, 'export function parseManagedServerSmokeArgs');
      requireText(errors, path, text, 'export async function createManagedServerWorkflowSmokeReport');
      requireText(errors, path, text, 'normalizeCliArgs(argv)');
      requireText(errors, path, text, 'createHttpWorkflowSmokeReport');
      requireText(errors, path, text, 'hostBuild');
      requireText(errors, path, text, 'hostStart');
      requireText(errors, path, text, 'hostHealth');
      requireText(errors, path, text, 'workflowSmoke');
      requireText(errors, path, text, 'processCleanup');
      requireText(errors, path, text, 'runtime');
      requireText(errors, path, text, "authMode: 'single-user-token'");
      requireText(errors, path, text, 'sanitizeWorkflowEvidence');
      requireText(errors, path, text, 'reportContainsSensitiveData');
      requireText(errors, path, text, 'redaction');
      requireText(errors, path, text, '--report-path');
    },
  });
}

function checkManagedUiSmokeContract(projectRoot) {
  const path = 'scripts/run-video-cut-managed-ui-smoke.mjs';
  const text = readText(projectRoot, path);
  return contractCheck({
    id: 'managed-ui-smoke-contract',
    evidence:
      'Managed UI smoke uses runtime injection and sanitized browser env, then records private browser artifact delivery, diagnostics, settings redaction, and path-leak evidence.',
    validate(errors) {
      requireFile(errors, projectRoot, path);
      requireText(errors, path, text, "REPORT_VERSION = 'video-cut.managed-ui-workflow-smoke.v1'");
      requireText(errors, path, text, 'export function parseManagedUiSmokeArgs');
      requireText(errors, path, text, 'export async function createManagedUiWorkflowSmokeReport');
      requireText(errors, path, text, 'normalizeCliArgs(argv)');
      requireText(errors, path, text, '__SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__');
      requireText(errors, path, text, 'createBrowserChildProcessEnv');
      requireText(errors, path, text, 'artifactContentAuthorizationVerified');
      requireText(errors, path, text, 'artifactContentEndpointFetched');
      requireText(errors, path, text, 'artifactDownloadAuthorizationVerified');
      requireText(errors, path, text, 'artifactDownloadContentFetched');
      requireText(errors, path, text, 'outputPreviewBlobUrl');
      requireText(errors, path, text, 'localPathLeakVisible');
      requireText(errors, path, text, 'settingsRedactionVerified');
      requireText(errors, path, text, 'diagnosticsBundleVerified');
      requireText(errors, path, text, 'reportContainsSensitiveData');
      requireText(errors, path, text, 'redaction');
      requireText(errors, path, text, '--report-path');
    },
  });
}

function checkReleaseSmokeScriptsContract(projectRoot) {
  const packageJson = readJson(projectRoot, 'package.json');
  const requiredScripts = {
    'release:smoke:container': 'scripts/run-video-cut-http-workflow-smoke.mjs',
    'release:smoke:desktop': 'scripts/run-video-cut-http-workflow-smoke.mjs',
    'release:smoke:kubernetes': 'scripts/run-video-cut-http-workflow-smoke.mjs',
    'release:smoke:server': 'scripts/run-video-cut-managed-server-smoke.mjs',
    'release:smoke:web': 'scripts/run-video-cut-managed-ui-smoke.mjs',
  };
  const failures = [];
  for (const [scriptName, runner] of Object.entries(requiredScripts)) {
    const script = String(packageJson.scripts?.[scriptName] ?? '');
    const target = scriptName.split(':').pop();
    const smokeReportPath = `artifacts/release/smoke/${target}-smoke-report.json`;
    if (!script.includes(runner)) {
      failures.push(`${scriptName}: runner=${runner}`);
    }
    if (!script.includes('--report-path') || !script.includes(smokeReportPath)) {
      failures.push(`${scriptName}: writes ${smokeReportPath} via --report-path`);
    }
    if (!script.includes('scripts/release/run-release-with-governance.mjs smoke')) {
      failures.push(`${scriptName}: uses release governance smoke wrapper`);
    }
    if (!script.includes('--smoke-report') || !script.includes(smokeReportPath)) {
      failures.push(`${scriptName}: passes ${smokeReportPath} via --smoke-report`);
    }
    if (!script.includes('--release-assets-dir artifacts/release')) {
      failures.push(`${scriptName}: pins release assets dir`);
    }
  }

  return checkResult({
    id: 'release-smoke-scripts-contract',
    passed: failures.length === 0,
    evidence:
      'All release:smoke:* scripts write a project-relative smoke report and pass it into release governance smoke validation.',
    failMessage: `Release smoke script drift: ${failures.join('; ')}`,
  });
}

function checkReleaseSmokeValidationContract(projectRoot) {
  const releaseScript = readText(projectRoot, 'scripts/release/local-release-command.mjs');
  const releaseContracts = readText(projectRoot, 'scripts/check-video-cut-release-contracts.mjs');
  const combined = `${releaseScript}\n${releaseContracts}`;
  return contractCheck({
    id: 'release-smoke-validation-contract',
    evidence:
      'Release package and release contract validators enforce smoke report versions, private artifact delivery proof, redaction, and sealed smoke evidence bundles.',
    validate(errors) {
      requireText(errors, 'release smoke validators', combined, 'SMOKE_REPORT_VERSIONS');
      requireText(errors, 'release smoke validators', combined, 'validateSmokeReport');
      requireText(errors, 'release smoke validators', combined, 'validateHttpWorkflowSmokeReport');
      requireText(errors, 'release smoke validators', combined, 'validateManagedServerSmokeReport');
      requireText(errors, 'release smoke validators', combined, 'validateWebSmokeReport');
      requireText(errors, 'release smoke validators', combined, 'createSmokeEvidenceBundle');
      requireText(errors, 'release smoke validators', combined, 'createSmokeEvidenceSummary');
      requireText(errors, 'release smoke validators', combined, 'checkSmokeEvidenceBundle');
      requireText(errors, 'release smoke validators', combined, 'validateSmokeEvidenceBundle');
      requireText(errors, 'release smoke validators', combined, 'validateSmokeEvidenceSummary');
      requireText(errors, 'release smoke validators', combined, 'host-content-endpoint');
      requireText(errors, 'release smoke validators', combined, 'artifacts.output.bytesChecked');
      requireText(errors, 'release smoke validators', combined, 'artifacts.output.mp4Signature');
      requireText(errors, 'release smoke validators', combined, 'artifacts.output.rangeChecked');
      requireText(errors, 'release smoke validators', combined, 'artifacts.output.rangeBytesChecked');
      requireText(errors, 'release smoke validators', combined, 'artifacts.output.securityHeadersChecked');
      requireText(errors, 'release smoke validators', combined, 'ui.artifactContentAuthorizationVerified');
      requireText(errors, 'release smoke validators', combined, 'ui.artifactDownloadAuthorizationVerified');
      requireText(errors, 'release smoke validators', combined, 'ui.outputPreviewBlobUrl');
      requireText(errors, 'release smoke validators', combined, 'ui.localPathLeakVisible');
      requireText(errors, 'release smoke validators', combined, 'reportContainsSensitiveData');
      requireText(errors, 'release smoke validators', combined, 'findLocalAbsolutePath');
    },
  });
}

function checkSmokeReportSamples({ projectRoot, smokeReports, strict }) {
  return smokeReports.map(({ path, target }) => {
    const normalizedPath = normalizeProjectPath(path);
    if (!SMOKE_REPORT_VERSIONS[target]) {
      return checkResult({
        id: `smoke-report-sample-${target}`,
        passed: false,
        evidence: '',
        failMessage: `${target} is not a supported smoke evidence target.`,
      });
    }

    if (!isSafeRelativePath(normalizedPath)) {
      return checkResult({
        id: `smoke-report-sample-${target}`,
        passed: false,
        evidence: '',
        failMessage: `${normalizedPath} must be project-relative and must not contain parent-directory segments.`,
      });
    }

    const absolutePath = resolve(projectRoot, normalizedPath);
    if (!existsSync(absolutePath)) {
      return {
        id: `smoke-report-sample-${target}`,
        status: strict ? 'fail' : 'warn',
        evidence: strict
          ? `Required smoke report sample is missing: ${normalizedPath}`
          : `Optional smoke report sample not present: ${normalizedPath}`,
      };
    }

    let report;
    try {
      report = JSON.parse(readFileSync(absolutePath, 'utf8'));
    } catch (error) {
      return checkResult({
        id: `smoke-report-sample-${target}`,
        passed: false,
        evidence: '',
        failMessage: `Unable to parse smoke report ${normalizedPath}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const validation = validateSmokeReportObject(target, report);
    const bytes = readFileSync(absolutePath);
    return checkResult({
      id: `smoke-report-sample-${target}`,
      passed: validation.valid,
      evidence: `${normalizedPath} sha256=${createHash('sha256').update(bytes).digest('hex')}`,
      failMessage: `${normalizedPath}: ${validation.reason}`,
    });
  });
}

function validateSmokeReportObject(target, report) {
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
  const missingTrueFields = REQUIRED_WEB_SMOKE_TRUE_FIELDS.filter((field) => valueAtPath(report, field) !== true);
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

  for (const [field, expected] of [
    ['artifacts.output.downloadMode', 'host-content-endpoint'],
    ['artifacts.manifest.downloadMode', 'host-content-endpoint'],
    ['artifacts.log.downloadMode', 'host-content-endpoint'],
  ]) {
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

function parseSmokeReportArg(value) {
  const separatorIndex = value.indexOf('=');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error('--smoke-report requires target=path.');
  }

  const target = value.slice(0, separatorIndex);
  const path = value.slice(separatorIndex + 1);
  if (!SMOKE_REPORT_VERSIONS[target]) {
    throw new Error(`Unsupported smoke report target: ${target}`);
  }

  return { target, path };
}

function contractCheck({ evidence, id, validate }) {
  const errors = [];
  try {
    validate(errors);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return checkResult({
    id,
    passed: errors.length === 0,
    evidence,
    failMessage: `${id} drift: ${errors.join('; ')}`,
  });
}

function requireFile(errors, projectRoot, path) {
  if (!existsSync(resolve(projectRoot, path))) {
    errors.push(`${path} must exist`);
  }
}

function requireText(errors, label, actual, token) {
  if (!String(actual ?? '').includes(token)) {
    errors.push(`${label} must contain ${token}`);
  }
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function checkResult({ evidence, failMessage, id, passed }) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    evidence: passed ? evidence : failMessage,
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

function hasOkCheck(report, checkId) {
  return Array.isArray(report?.checks) && report.checks.some((check) => check?.checkId === checkId && check?.status === 'ok');
}

function valueAtPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function readJson(projectRoot, path) {
  return JSON.parse(readText(projectRoot, path));
}

function readText(projectRoot, path) {
  const absolutePath = resolve(projectRoot, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function normalizeProjectPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
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

function reportContainsSensitiveData(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return Boolean(
    serialized.includes('"apiKey"') ||
      serialized.includes('"authorization"') ||
      serialized.includes('"serverToken"') ||
      serialized.includes('"authToken"') ||
      /Bearer\s+[A-Za-z0-9._-]+/.test(serialized) ||
      /\bsk-[A-Za-z0-9_-]{8,}/.test(serialized),
  );
}

function findLocalAbsolutePath(value, path = '$') {
  if (typeof value === 'string') {
    return isLocalAbsolutePath(value) ? path : '';
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const childPath = findLocalAbsolutePath(value[index], `${path}[${index}]`);
      if (childPath) {
        return childPath;
      }
    }
    return '';
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = findLocalAbsolutePath(child, `${path}.${key}`);
      if (childPath) {
        return childPath;
      }
    }
  }

  return '';
}

function isLocalAbsolutePath(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return false;
  }

  return Boolean(
    /^[A-Za-z]:[\\/]/.test(normalized) ||
      /^\\\\[^\\]+\\[^\\]+/.test(normalized) ||
      /^\/(?:Users|home|var|tmp|private|mnt|opt|workspace|data|Volumes)\b/.test(normalized),
  );
}

function printHumanReport(report) {
  const lines = [
    'SDKWork Video Cut Smoke Evidence Contracts',
    `status: ${report.status}`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    `reportPath: ${report.reportPath}`,
    '',
    ...report.checks.map((check) => `${check.status.toUpperCase()} ${check.id}: ${check.evidence}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}
