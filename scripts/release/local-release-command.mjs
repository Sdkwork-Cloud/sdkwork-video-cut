#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const REPORT_VERSION = 'video-cut.local-release-command.v1';
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

export function parseReleaseArgs(argv) {
  const args = [...argv];
  const action = args.shift();
  const target = args.shift();
  let releaseAssetsDir = 'artifacts/release';
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

    if (arg === '--smoke-report') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--smoke-report requires a value.');
      }
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
    ...(smokeReportPath ? { smokeReportPath } : {}),
    target,
  };
}

export function createReleaseCommandReport({
  action,
  projectRoot = process.cwd(),
  releaseAssetsDir = 'artifacts/release',
  smokeReportPath = '',
  target,
}) {
  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const requirements = TARGET_REQUIREMENTS[target] ?? [];
  const requirementArtifacts = requirements.map((path) => createArtifactRecord(projectRoot, path));
  const smokeEvidence = createSmokeEvidence(projectRoot, action, target, smokeReportPath);
  const artifacts = [...requirementArtifacts, ...smokeEvidence.artifacts];
  const checks = requirementArtifacts.map((artifact) => {
    return {
      id: `${target}-${artifact.path.replace(/[\\/\.]/g, '-')}`,
      status: artifact.exists ? 'pass' : 'fail',
      evidence: artifact.path,
    };
  }).concat(smokeEvidence.checks);
  const summary = summarizeChecks(checks);
  const releaseFiles = writeStandardReleaseFiles({
    action,
    artifacts,
    checks,
    projectRoot,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    summary,
    target,
  });
  const actionReportPath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/${target}-${action}-report.json`);
  const report = {
    reportVersion: REPORT_VERSION,
    action,
    target,
    status: summary.fail === 0 ? 'pass' : 'fail',
    generatedAt: new Date().toISOString(),
    releaseAssetsDir: normalizedReleaseAssetsDir,
    summary,
    checks,
    actionReportPath,
    ...releaseFiles,
  };

  writeReleaseReport(resolve(projectRoot, actionReportPath), report);
  return report;
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

function reportContainsSensitiveData(report) {
  const serialized = JSON.stringify(report);
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

function writeStandardReleaseFiles({
  action,
  artifacts,
  checks,
  projectRoot,
  releaseAssetsDir,
  summary,
  target,
}) {
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const releaseRoot = resolve(projectRoot, normalizedReleaseAssetsDir);
  mkdirSync(releaseRoot, { recursive: true });
  const generatedAt = new Date().toISOString();
  const status = summary.fail === 0 ? 'pass' : 'fail';
  const existingArtifacts = artifacts.filter((artifact) => artifact.exists);
  const runtimeProfile = runtimeProfileForTarget(projectRoot, target);

  const manifestPath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/release-manifest.json`);
  const checksumsPath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/SHA256SUMS.txt`);
  const releaseNotesPath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/release-notes.md`);
  const qualityGateReportPath = normalizeProjectPath(`${normalizedReleaseAssetsDir}/quality-gate-execution-report.json`);
  const absoluteManifestPath = resolve(projectRoot, manifestPath);
  const absoluteChecksumsPath = resolve(projectRoot, checksumsPath);
  const absoluteReleaseNotesPath = resolve(projectRoot, releaseNotesPath);
  const absoluteQualityGateReportPath = resolve(projectRoot, qualityGateReportPath);

  const manifest = {
    manifestVersion: 'video-cut.release-manifest.v1',
    product: 'sdkwork-video-cut',
    action,
    target,
    runtimeProfile,
    contractVersions: CONTRACT_VERSIONS,
    status,
    generatedAt,
    artifacts: buildReleaseArtifactRecords({
      existingArtifacts,
      projectRoot,
      releaseRoot,
    }).map(({ exists, absolutePath, ...artifact }) => artifact),
  };
  const releaseArtifacts = manifest.artifacts;
  const checksums = releaseArtifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.path}`)
    .join('\n');
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

  writeFileSync(absoluteManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(absoluteChecksumsPath, `${checksums}${checksums ? '\n' : ''}`, 'utf8');
  writeFileSync(
    absoluteReleaseNotesPath,
    [
      `# sdkwork-video-cut ${target} ${action}`,
      '',
      `- status: ${status}`,
      `- generatedAt: ${generatedAt}`,
      `- artifacts: ${releaseArtifacts.length}`,
      `- failedChecks: ${summary.fail}`,
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(absoluteQualityGateReportPath, `${JSON.stringify(qualityReport, null, 2)}\n`, 'utf8');

  return {
    checksumsPath,
    manifestPath,
    qualityGateReportPath,
    releaseNotesPath,
  };
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

function buildReleaseArtifactRecords({ existingArtifacts, projectRoot, releaseRoot }) {
  const sbomPath = resolve(releaseRoot, 'sdkwork-video-cut-sbom.cdx.json');
  writeFileSync(sbomPath, `${JSON.stringify(createCycloneDxSbom(projectRoot), null, 2)}\n`, 'utf8');

  return [
    ...existingArtifacts,
    createArtifactRecordFromBytes('sdkwork-video-cut-sbom.cdx.json', readFileSync(sbomPath)),
  ];
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
