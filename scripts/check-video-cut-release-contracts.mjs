#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { normalizeCliArgs } from './lib/cli-args.mjs';
import { createReportPath } from './lib/report-paths.mjs';
import { findLocalAbsolutePath, reportContainsSensitiveData } from './lib/report-safety.mjs';

const REPORT_VERSION = 'video-cut.release-contracts-report.v1';
const COMMAND = 'check:release-contracts';
const DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const GOVERNANCE_EVIDENCE_BUNDLE_VERSION = 'video-cut.governance-evidence-bundle.v1';
const SMOKE_EVIDENCE_BUNDLE_VERSION = 'video-cut.smoke-evidence-bundle.v1';
const PROVENANCE_VERSION = 'video-cut.release-provenance.v1';
const RELEASE_SIGNATURE_VERSION = 'video-cut.release-signature.v1';
const REQUIRED_BASE_RELEASE_FILES = [
  'release-manifest.json',
  'quality-gate-execution-report.json',
  'SHA256SUMS.txt',
  'release-notes.md',
  'governance-evidence-bundle.json',
  'provenance.json',
  'release-signature.json',
  'sdkwork-video-cut-sbom.cdx.json',
];
const REQUIRED_SMOKE_RELEASE_FILES = ['smoke-evidence-bundle.json'];
const REQUIRED_CONTRACT_VERSIONS = {
  api: 'openapi.video-cut.v1',
  schema: 'video-cut.schema-bundle.v1',
  provider: 'video-cut.provider-capability.schema.v1',
  runtimeProfile: 'video-cut.runtime-profile.v1',
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

export function parseReleaseContractsArgs(argv) {
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

    throw new Error(`Unknown release contracts argument: ${arg}`);
  }

  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  return { json, releaseAssetsDir: normalizeProjectPath(releaseAssetsDir), reportDir: normalizeProjectPath(reportDir) };
}

export function createReleaseContractsReport({
  projectRoot = process.cwd(),
  releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR,
  reportDir = DEFAULT_REPORT_DIR,
} = {}) {
  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const normalizedReportDir = normalizeProjectPath(reportDir);
  const governanceReportDefinitions = createGovernanceReportDefinitions(normalizedReportDir);
  const releaseRoot = resolve(projectRoot, normalizedReleaseAssetsDir);
  const releaseFiles = readReleaseFiles(releaseRoot);
  const manifest = releaseFiles.manifest.value;
  const qualityReport = releaseFiles.qualityReport.value;
  const actionReport = readActionReport(releaseRoot, manifest);

  const checks = [
    checkResult({
      id: 'release-assets-directory-present',
      passed: existsSync(releaseRoot),
      evidence: normalizedReleaseAssetsDir,
      failMessage: `Release assets directory is missing: ${normalizedReleaseAssetsDir}`,
    }),
    checkStandardFiles(releaseRoot, manifest),
    checkReleaseRootGeneratedFilesSealed(releaseRoot, manifest, actionReport),
    checkReleasePackageFileSetSealed(releaseRoot, manifest, actionReport),
    checkActionReportPresent(manifest, actionReport),
    checkManifestContract(manifest),
    checkQualityReportContract(manifest, qualityReport),
    checkActionReportContract({
      actionReport,
      manifest,
      normalizedReleaseAssetsDir,
      qualityReport,
    }),
    checkReleaseJsonSafety([
      manifest,
      qualityReport,
      actionReport?.value,
      releaseFiles.governanceEvidenceBundle.value,
      manifest?.action === 'smoke' ? releaseFiles.smokeEvidenceBundle.value : undefined,
      releaseFiles.provenance.value,
      releaseFiles.signature.value,
      releaseFiles.sbom.value,
    ]),
    checkArtifactRecords({
      artifacts: Array.isArray(manifest?.artifacts) ? manifest.artifacts : [],
      projectRoot,
      releaseRoot,
    }),
    checkSha256Sums({
      artifacts: Array.isArray(manifest?.artifacts) ? manifest.artifacts : [],
      checksumsText: releaseFiles.checksumsText,
    }),
    checkGovernanceEvidence({
      actionReport: actionReport?.value,
      governanceReportDefinitions,
      governanceEvidenceBundle: releaseFiles.governanceEvidenceBundle.value,
      manifest,
      projectRoot,
      qualityReport,
      releaseRoot,
    }),
    checkSmokeEvidenceBundle({
      actionReport: actionReport?.value,
      manifest,
      projectRoot,
      qualityReport,
      releaseRoot,
      smokeEvidenceBundle: releaseFiles.smokeEvidenceBundle.value,
    }),
    checkReleaseProvenance({
      actionReport,
      manifest,
      normalizedReleaseAssetsDir,
      projectRoot,
      provenance: releaseFiles.provenance.value,
      qualityReport,
      releaseRoot,
    }),
    checkReleaseSignature({
      actionReport,
      checksumsText: releaseFiles.checksumsText,
      manifest,
      normalizedReleaseAssetsDir,
      projectRoot,
      qualityReport,
      releaseRoot,
      signature: releaseFiles.signature.value,
    }),
    checkSbom(releaseFiles.sbom.value),
  ];
  const summary = summarizeChecks(checks);
  const { absolutePath, reportPath } = createReportPath(
    projectRoot,
    normalizedReportDir,
    'release-contracts-report.json',
  );
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summary.fail === 0 ? 'pass' : 'fail',
    checkedAt: new Date().toISOString(),
    releaseAssetsDir: normalizedReleaseAssetsDir,
    action: typeof manifest?.action === 'string' ? manifest.action : '',
    target: typeof manifest?.target === 'string' ? manifest.target : '',
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
  const options = parseReleaseContractsArgs(process.argv.slice(2));
  const report = createReleaseContractsReport(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanReport(report);
  }
  process.exitCode = report.status === 'pass' ? 0 : 1;
}

function readReleaseFiles(releaseRoot) {
  return {
    manifest: readJsonFile(resolve(releaseRoot, 'release-manifest.json')),
    qualityReport: readJsonFile(resolve(releaseRoot, 'quality-gate-execution-report.json')),
    checksumsText: readTextFile(resolve(releaseRoot, 'SHA256SUMS.txt')),
    governanceEvidenceBundle: readJsonFile(resolve(releaseRoot, 'governance-evidence-bundle.json')),
    smokeEvidenceBundle: readJsonFile(resolve(releaseRoot, 'smoke-evidence-bundle.json')),
    provenance: readJsonFile(resolve(releaseRoot, 'provenance.json')),
    signature: readJsonFile(resolve(releaseRoot, 'release-signature.json')),
    sbom: readJsonFile(resolve(releaseRoot, 'sdkwork-video-cut-sbom.cdx.json')),
  };
}

function readActionReport(releaseRoot, manifest) {
  const action = manifest?.action;
  const target = manifest?.target;
  if (typeof action === 'string' && typeof target === 'string') {
    const expectedPath = resolve(releaseRoot, `${target}-${action}-report.json`);
    const expected = readJsonFile(expectedPath);
    if (expected.exists) {
      return { fileName: `${target}-${action}-report.json`, ...expected };
    }
  }

  if (!existsSync(releaseRoot)) {
    return { exists: false, fileName: '', value: undefined, error: 'Release assets directory is missing.' };
  }

  const candidates = readdirSync(releaseRoot).filter((fileName) => /-(package|smoke)-report\.json$/.test(fileName));
  if (candidates.length !== 1) {
    return {
      exists: false,
      fileName: '',
      value: undefined,
      error: `Expected exactly one action report, found: ${candidates.join(', ')}`,
    };
  }

  return { fileName: candidates[0], ...readJsonFile(resolve(releaseRoot, candidates[0])) };
}

function checkStandardFiles(releaseRoot, manifest) {
  const requiredFiles = [
    ...REQUIRED_BASE_RELEASE_FILES,
    ...(manifest?.action === 'smoke' ? REQUIRED_SMOKE_RELEASE_FILES : []),
  ];
  const missingFiles = requiredFiles.filter((fileName) => !existsSync(resolve(releaseRoot, fileName)));
  const actionReports = existsSync(releaseRoot)
    ? readdirSync(releaseRoot).filter((fileName) => /-(package|smoke)-report\.json$/.test(fileName))
    : [];

  return checkResult({
    id: 'standard-release-files-present',
    passed: missingFiles.length === 0 && actionReports.length === 1,
    evidence: `${requiredFiles.join(', ')}; actionReport=${actionReports.join(', ')}`,
    failMessage: `Release package standard files are incomplete. Missing: ${missingFiles.join(', ')} actionReports: ${actionReports.join(', ')}`,
  });
}

function checkReleaseRootGeneratedFilesSealed(releaseRoot, manifest, actionReport) {
  const failures = [];
  const expectedActionReport =
    typeof manifest?.target === 'string' && typeof manifest?.action === 'string'
      ? `${manifest.target}-${manifest.action}-report.json`
      : '';
  const manifestRootArtifactFiles = new Set(
    (Array.isArray(manifest?.artifacts) ? manifest.artifacts : [])
      .map((artifact) => normalizeProjectPath(artifact?.path))
      .filter((artifactPath) => artifactPath && !artifactPath.includes('/')),
  );
  const allowedRootFiles = new Set([
    ...REQUIRED_BASE_RELEASE_FILES,
    ...(manifest?.action === 'smoke' ? REQUIRED_SMOKE_RELEASE_FILES : []),
    ...(expectedActionReport ? [expectedActionReport] : []),
    ...manifestRootArtifactFiles,
  ]);

  if (!existsSync(releaseRoot)) {
    failures.push('release assets directory is missing');
  } else {
    for (const entry of readdirSync(releaseRoot, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }

      if (!allowedRootFiles.has(entry.name)) {
        failures.push(`${entry.name}: root file is not sealed by the release manifest for ${manifest?.target ?? '<unknown>'}/${manifest?.action ?? '<unknown>'}`);
      }
    }
  }

  if (expectedActionReport && actionReport?.fileName && actionReport.fileName !== expectedActionReport) {
    failures.push(`${actionReport.fileName}: action report does not match expected ${expectedActionReport}`);
  }

  if (manifest?.action !== 'smoke' && existsSync(resolve(releaseRoot, 'smoke-evidence-bundle.json'))) {
    failures.push('smoke-evidence-bundle.json: package actions must not carry stale smoke evidence at the release root');
  }

  return checkResult({
    id: 'release-root-generated-files-sealed',
    passed: failures.length === 0,
    evidence:
      'Release root generated files are limited to the current standard files, the expected action report, and manifest-listed root artifacts.',
    failMessage: `Release root contains unsealed or stale generated files: ${failures.join('; ')}`,
  });
}

function checkReleasePackageFileSetSealed(releaseRoot, manifest, actionReport) {
  const failures = [];
  const manifestArtifactPaths = new Set(
    (Array.isArray(manifest?.artifacts) ? manifest.artifacts : [])
      .map((artifact) => normalizeProjectPath(artifact?.path))
      .filter(Boolean),
  );
  const expectedActionReport =
    typeof manifest?.target === 'string' && typeof manifest?.action === 'string'
      ? `${manifest.target}-${manifest.action}-report.json`
      : '';
  const allowedFiles = new Set([
    ...REQUIRED_BASE_RELEASE_FILES,
    ...(manifest?.action === 'smoke' ? REQUIRED_SMOKE_RELEASE_FILES : []),
    ...(expectedActionReport ? [expectedActionReport] : []),
    ...manifestArtifactPaths,
  ]);
  const actualFiles = listReleasePackageFiles(releaseRoot);

  if (!existsSync(releaseRoot)) {
    failures.push('release assets directory is missing');
  }

  for (const fileName of actualFiles) {
    if (!allowedFiles.has(fileName)) {
      failures.push(`${fileName}: file is present in the release package but absent from release-manifest.json`);
    }
  }

  for (const artifactPath of manifestArtifactPaths) {
    if (!actualFiles.has(artifactPath)) {
      failures.push(`${artifactPath}: manifest artifact is missing from the sealed release package`);
    }
  }

  return checkResult({
    id: 'release-package-file-set-sealed',
    passed: failures.length === 0,
    evidence:
      'Every file under the release package is either a standard release file, the current action report, or listed in release-manifest.json.',
    failMessage: `Release package file set is not sealed: ${failures.join('; ')}`,
  });
}

function checkActionReportPresent(manifest, actionReport) {
  const expectedFile =
    typeof manifest?.target === 'string' && typeof manifest?.action === 'string'
      ? `${manifest.target}-${manifest.action}-report.json`
      : '';
  return checkResult({
    id: 'action-report-present',
    passed: Boolean(actionReport?.exists) && (!expectedFile || actionReport.fileName === expectedFile),
    evidence: expectedFile || actionReport?.fileName || 'action report',
    failMessage: actionReport?.error ?? `Expected action report is missing: ${expectedFile}`,
  });
}

function checkManifestContract(manifest) {
  const failedFields = [];
  if (manifest?.manifestVersion !== 'video-cut.release-manifest.v1') {
    failedFields.push('manifestVersion=video-cut.release-manifest.v1');
  }
  if (manifest?.product !== 'sdkwork-video-cut') {
    failedFields.push('product=sdkwork-video-cut');
  }
  if (manifest?.action !== 'package' && manifest?.action !== 'smoke') {
    failedFields.push('action=package|smoke');
  }
  if (!['desktop', 'server', 'web', 'container', 'kubernetes'].includes(manifest?.target)) {
    failedFields.push('target');
  }
  if (manifest?.status !== 'pass') {
    failedFields.push('status=pass');
  }
  if (!deepEqual(manifest?.contractVersions, REQUIRED_CONTRACT_VERSIONS)) {
    failedFields.push('contractVersions');
  }
  if (manifest?.runtimeProfile?.releaseTarget !== manifest?.target) {
    failedFields.push('runtimeProfile.releaseTarget=target');
  }
  if (manifest?.runtimeProfile?.apiContract !== '/api/video-cut/v1') {
    failedFields.push('runtimeProfile.apiContract=/api/video-cut/v1');
  }
  if (!Array.isArray(manifest?.artifacts) || manifest.artifacts.length === 0) {
    failedFields.push('artifacts');
  }
  if (!manifest?.artifacts?.some((artifact) => artifact?.path === 'provenance.json')) {
    failedFields.push('artifacts.provenance.json');
  }
  if (!manifest?.artifacts?.some((artifact) => artifact?.path === 'release-signature.json')) {
    failedFields.push('artifacts.release-signature.json');
  }
  if (!manifest?.artifacts?.some((artifact) => artifact?.path === 'release-notes.md')) {
    failedFields.push('artifacts.release-notes.md');
  }

  return checkResult({
    id: 'release-manifest-contract',
    passed: failedFields.length === 0,
    evidence: 'release-manifest.json declares product, target, runtime profile, contract versions, status, and artifacts.',
    failMessage: `Release manifest contract drift: ${failedFields.join(', ')}`,
  });
}

function checkQualityReportContract(manifest, qualityReport) {
  const failedFields = [];
  if (qualityReport?.gateVersion !== 'video-cut.quality-gate-report.v1') {
    failedFields.push('gateVersion=video-cut.quality-gate-report.v1');
  }
  if (qualityReport?.action !== manifest?.action) {
    failedFields.push('action');
  }
  if (qualityReport?.target !== manifest?.target) {
    failedFields.push('target');
  }
  if (qualityReport?.status !== manifest?.status || qualityReport?.status !== 'pass') {
    failedFields.push('status=pass');
  }
  if (!deepEqual(qualityReport?.runtimeProfile, manifest?.runtimeProfile)) {
    failedFields.push('runtimeProfile');
  }
  if (!deepEqual(qualityReport?.contractVersions, manifest?.contractVersions)) {
    failedFields.push('contractVersions');
  }
  if (Number(qualityReport?.summary?.fail ?? 1) !== 0) {
    failedFields.push('summary.fail=0');
  }
  if (!Array.isArray(qualityReport?.checks) || qualityReport.checks.some((check) => check?.status !== 'pass')) {
    failedFields.push('checks.status=pass');
  }

  return checkResult({
    id: 'quality-gate-report-contract',
    passed: failedFields.length === 0,
    evidence: 'quality-gate-execution-report.json matches release manifest and has zero failed checks.',
    failMessage: `Quality gate report contract drift: ${failedFields.join(', ')}`,
  });
}

function checkActionReportContract({ actionReport, manifest, normalizedReleaseAssetsDir, qualityReport }) {
  const report = actionReport?.value;
  const expectedActionReportPath =
    typeof manifest?.target === 'string' && typeof manifest?.action === 'string'
      ? `${normalizedReleaseAssetsDir}/${manifest.target}-${manifest.action}-report.json`
      : '';
  const failedFields = [];

  if (report?.reportVersion !== 'video-cut.local-release-command.v1') {
    failedFields.push('reportVersion=video-cut.local-release-command.v1');
  }
  if (report?.action !== manifest?.action) {
    failedFields.push('action');
  }
  if (report?.target !== manifest?.target) {
    failedFields.push('target');
  }
  if (report?.status !== manifest?.status || report?.status !== 'pass') {
    failedFields.push('status=pass');
  }
  if (report?.releaseAssetsDir !== normalizedReleaseAssetsDir) {
    failedFields.push('releaseAssetsDir');
  }
  if (report?.actionReportPath !== expectedActionReportPath) {
    failedFields.push('actionReportPath');
  }
  if (report?.checksumsPath !== `${normalizedReleaseAssetsDir}/SHA256SUMS.txt`) {
    failedFields.push('checksumsPath');
  }
  if (report?.manifestPath !== `${normalizedReleaseAssetsDir}/release-manifest.json`) {
    failedFields.push('manifestPath');
  }
  if (report?.qualityGateReportPath !== `${normalizedReleaseAssetsDir}/quality-gate-execution-report.json`) {
    failedFields.push('qualityGateReportPath');
  }
  if (report?.provenancePath !== `${normalizedReleaseAssetsDir}/provenance.json`) {
    failedFields.push('provenancePath');
  }
  if (report?.releaseNotesPath !== `${normalizedReleaseAssetsDir}/release-notes.md`) {
    failedFields.push('releaseNotesPath');
  }
  if (report?.signaturePath !== `${normalizedReleaseAssetsDir}/release-signature.json`) {
    failedFields.push('signaturePath');
  }
  if (Number(report?.summary?.fail ?? 1) !== 0 || !deepEqual(report?.summary, qualityReport?.summary)) {
    failedFields.push('summary');
  }
  if (!deepEqual(report?.checks, qualityReport?.checks)) {
    failedFields.push('checks');
  }

  return checkResult({
    id: 'local-release-action-report-contract',
    passed: failedFields.length === 0,
    evidence: 'Action report matches manifest, quality report, and standard release file paths.',
    failMessage: `Action report contract drift: ${failedFields.join(', ')}`,
  });
}

function checkReleaseJsonSafety(values) {
  const serialized = values.filter((value) => value !== undefined).map((value) => JSON.stringify(value)).join('\n');
  const sensitive = reportContainsSensitiveData(serialized);
  const localPath = findLocalAbsolutePath(values);

  return checkResult({
    id: 'release-json-redaction-and-path-safety',
    passed: !sensitive && !localPath,
    evidence: 'Release JSON artifacts contain no credential-shaped values and no server-local absolute paths.',
    failMessage: `Release JSON artifacts must not contain sensitive data or local paths. Sensitive=${sensitive} localPath=${localPath}`,
  });
}

function checkArtifactRecords({ artifacts, projectRoot, releaseRoot }) {
  const failures = [];
  const seenPaths = new Set();

  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    failures.push('manifest.artifacts must be a non-empty array');
  }

  for (const artifact of artifacts) {
    const artifactPath = normalizeProjectPath(artifact?.path);
    if (!isSafeRelativePath(artifact?.path)) {
      failures.push(`${String(artifact?.path)}: unsafe path`);
      continue;
    }
    if (seenPaths.has(artifactPath)) {
      failures.push(`${artifactPath}: duplicate path`);
    }
    seenPaths.add(artifactPath);
    if (!/^[a-f0-9]{64}$/.test(String(artifact?.sha256 ?? ''))) {
      failures.push(`${artifactPath}: invalid sha256`);
    }
    if (!Number.isInteger(artifact?.sizeBytes) || artifact.sizeBytes <= 0) {
      failures.push(`${artifactPath}: invalid sizeBytes`);
    }

    const absolutePath = resolveArtifactPath({ artifactPath, projectRoot, releaseRoot });
    if (!existsSync(absolutePath)) {
      failures.push(`${artifactPath}: artifact file missing`);
      continue;
    }

    const bytes = readFileSync(absolutePath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== artifact.sha256) {
      failures.push(`${artifactPath}: sha256 mismatch`);
    }
    if (statSync(absolutePath).size !== artifact.sizeBytes) {
      failures.push(`${artifactPath}: sizeBytes mismatch`);
    }
  }

  return checkResult({
    id: 'manifest-artifact-integrity',
    passed: failures.length === 0,
    evidence: `${artifacts.length} manifest artifact records match on-disk size and SHA-256.`,
    failMessage: `Manifest artifact integrity failed: ${failures.join('; ')}`,
  });
}

function checkSha256Sums({ artifacts, checksumsText }) {
  const expected = Array.isArray(artifacts)
    ? artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join('\n')
    : '';
  const normalizedExpected = expected ? `${expected}\n` : '';
  const normalizedActual = checksumsText.replace(/\r\n/g, '\n');
  const lineFailures = normalizedActual
    .split('\n')
    .filter(Boolean)
    .filter((line) => !/^[a-f0-9]{64}  [^\r\n]+$/.test(line));

  return checkResult({
    id: 'checksums-match-manifest',
    passed: lineFailures.length === 0 && normalizedActual === normalizedExpected,
    evidence: 'SHA256SUMS.txt exactly matches release-manifest.json artifact order and hashes.',
    failMessage: `SHA256SUMS.txt drift. Invalid lines: ${lineFailures.join('; ')}`,
  });
}

function createGovernanceReportDefinitions(reportDir = DEFAULT_REPORT_DIR) {
  const normalizedReportDir = normalizeProjectPath(reportDir);
  return REQUIRED_GOVERNANCE_REPORTS.map((definition) => ({
    ...definition,
    path: `${normalizedReportDir}/${definition.fileName}`,
  }));
}

function checkGovernanceEvidence({
  actionReport,
  governanceReportDefinitions,
  governanceEvidenceBundle,
  manifest,
  projectRoot,
  qualityReport,
  releaseRoot,
}) {
  const manifestArtifactPaths = new Set((manifest?.artifacts ?? []).map((artifact) => artifact?.path));
  const qualityChecks = new Map((qualityReport?.checks ?? []).map((check) => [check?.id, check]));
  const actionChecks = new Map((actionReport?.checks ?? []).map((check) => [check?.id, check]));
  const bundleReports = new Map((governanceEvidenceBundle?.reports ?? []).map((report) => [report?.id, report]));
  const failures = [];

  if (governanceEvidenceBundle?.bundleVersion !== GOVERNANCE_EVIDENCE_BUNDLE_VERSION) {
    failures.push(`governance-evidence-bundle.json: bundleVersion must be ${GOVERNANCE_EVIDENCE_BUNDLE_VERSION}`);
  }
  if (governanceEvidenceBundle?.product !== 'sdkwork-video-cut') {
    failures.push('governance-evidence-bundle.json: product must be sdkwork-video-cut');
  }
  if (governanceEvidenceBundle?.action !== manifest?.action || governanceEvidenceBundle?.target !== manifest?.target) {
    failures.push('governance-evidence-bundle.json: action/target must match release manifest');
  }
  if (governanceEvidenceBundle?.status !== manifest?.status || governanceEvidenceBundle?.status !== 'pass') {
    failures.push('governance-evidence-bundle.json: status must be pass and match release manifest');
  }
  if (governanceEvidenceBundle?.summary?.fail !== 0 || governanceEvidenceBundle?.summary?.pass !== governanceReportDefinitions.length) {
    failures.push('governance-evidence-bundle.json: summary must show all governance reports passing');
  }
  if (!manifestArtifactPaths.has('governance-evidence-bundle.json')) {
    failures.push('governance-evidence-bundle.json: missing from release manifest artifacts');
  }

  for (const definition of governanceReportDefinitions) {
    const checkId = `governance-evidence-${definition.id}`;
    if (!manifestArtifactPaths.has(definition.path)) {
      failures.push(`${definition.path}: missing from release manifest artifacts`);
    }
    for (const [source, checks] of [
      ['quality', qualityChecks],
      ['action', actionChecks],
    ]) {
      const check = checks.get(checkId);
      if (check?.status !== 'pass' || check?.evidence !== definition.path) {
        failures.push(`${source}.${checkId}: must pass with evidence=${definition.path}`);
      }
    }

    const validation = validateGovernanceReport(projectRoot, definition, releaseRoot);
    if (!validation.valid) {
      failures.push(validation.reason);
    }

    const bundleReport = bundleReports.get(definition.id);
    const bundleValidation = validateGovernanceBundleReport(projectRoot, definition, bundleReport, releaseRoot);
    if (!bundleValidation.valid) {
      failures.push(bundleValidation.reason);
    }
  }

  return checkResult({
    id: 'release-governance-evidence-contract',
    passed: failures.length === 0,
    evidence:
      'Release manifest, action report, and quality report include passed CLI, database, deployment, OpenAPI, smoke evidence, readiness, readiness policy, and governance evidence.',
    failMessage: `Release governance evidence contract failed: ${failures.join('; ')}`,
  });
}

function validateGovernanceBundleReport(projectRoot, definition, bundleReport, releaseRoot) {
  if (!bundleReport) {
    return { valid: false, reason: `governance-evidence-bundle.json: missing report ${definition.id}.` };
  }

  if (bundleReport.path !== definition.path) {
    return { valid: false, reason: `governance-evidence-bundle.json: ${definition.id}.path must be ${definition.path}.` };
  }
  if (bundleReport.command !== definition.command) {
    return { valid: false, reason: `governance-evidence-bundle.json: ${definition.id}.command must be ${definition.command}.` };
  }
  if (bundleReport.reportVersion !== definition.reportVersion) {
    return {
      valid: false,
      reason: `governance-evidence-bundle.json: ${definition.id}.reportVersion must be ${definition.reportVersion}.`,
    };
  }
  if (bundleReport.reportPath !== definition.path) {
    return { valid: false, reason: `governance-evidence-bundle.json: ${definition.id}.reportPath must be ${definition.path}.` };
  }
  if (bundleReport.status !== 'pass') {
    return { valid: false, reason: `governance-evidence-bundle.json: ${definition.id}.status must be pass.` };
  }
  if (!/^[a-f0-9]{64}$/.test(String(bundleReport.sha256 ?? ''))) {
    return { valid: false, reason: `governance-evidence-bundle.json: ${definition.id}.sha256 must be SHA-256.` };
  }
  if (!Number.isInteger(bundleReport.sizeBytes) || bundleReport.sizeBytes <= 0) {
    return { valid: false, reason: `governance-evidence-bundle.json: ${definition.id}.sizeBytes must be positive.` };
  }
  if (reportContainsSensitiveData(bundleReport) || findLocalAbsolutePath(bundleReport)) {
    return { valid: false, reason: `governance-evidence-bundle.json: ${definition.id} contains sensitive data or local paths.` };
  }

  const governancePath = resolveArtifactPath({
    artifactPath: definition.path,
    projectRoot,
    releaseRoot,
  });
  if (!existsSync(governancePath)) {
    return { valid: false, reason: `governance-evidence-bundle.json: ${definition.path} is missing from packaged evidence.` };
  }
  const bytes = readFileSync(governancePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== bundleReport.sha256 || bytes.length !== bundleReport.sizeBytes) {
    return { valid: false, reason: `governance-evidence-bundle.json: ${definition.id} hash/size drifted from project evidence.` };
  }

  let projectReport;
  try {
    projectReport = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return {
      valid: false,
      reason: `governance-evidence-bundle.json: ${definition.id} project report JSON is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (!deepEqual(bundleReport.report, projectReport)) {
    return { valid: false, reason: `governance-evidence-bundle.json: ${definition.id} embedded report does not match project evidence.` };
  }
  if (!deepEqual(bundleReport.summary, projectReport.summary ?? {})) {
    return { valid: false, reason: `governance-evidence-bundle.json: ${definition.id} summary does not match embedded report.` };
  }

  return { valid: true, reason: '' };
}

function checkSmokeEvidenceBundle({ actionReport, manifest, projectRoot, qualityReport, releaseRoot, smokeEvidenceBundle }) {
  const manifestArtifactPaths = new Set((manifest?.artifacts ?? []).map((artifact) => artifact?.path));
  const smokeCheckId = `${manifest?.target}-smoke-report-evidence`;
  const qualityChecks = new Map((qualityReport?.checks ?? []).map((check) => [check?.id, check]));
  const actionChecks = new Map((actionReport?.checks ?? []).map((check) => [check?.id, check]));
  const failures = [];

  if (manifest?.action !== 'smoke') {
    return checkResult({
      id: 'release-smoke-evidence-bundle-contract',
      passed: !manifestArtifactPaths.has('smoke-evidence-bundle.json'),
      evidence: 'Package releases do not require smoke-evidence-bundle.json.',
      failMessage: 'Package release manifests must not include smoke-evidence-bundle.json.',
    });
  }

  if (!manifestArtifactPaths.has('smoke-evidence-bundle.json')) {
    failures.push('smoke-evidence-bundle.json: missing from release manifest artifacts');
  }

  for (const [source, checks] of [
    ['quality', qualityChecks],
    ['action', actionChecks],
  ]) {
    const check = checks.get(smokeCheckId);
    if (check?.status !== 'pass' || typeof check.evidence !== 'string' || !isSafeRelativePath(check.evidence)) {
      failures.push(`${source}.${smokeCheckId}: must pass with project-relative smoke report evidence`);
    }
  }

  const smokeReportPath = actionChecks.get(smokeCheckId)?.evidence ?? qualityChecks.get(smokeCheckId)?.evidence ?? '';
  if (typeof smokeReportPath !== 'string' || !isSafeRelativePath(smokeReportPath)) {
    failures.push('smoke report evidence path must be project-relative');
  } else if (!manifestArtifactPaths.has(smokeReportPath)) {
    failures.push(`${smokeReportPath}: missing from release manifest artifacts`);
  }

  const bundleValidation = validateSmokeEvidenceBundle({
    manifest,
    projectRoot,
    releaseRoot,
    smokeEvidenceBundle,
    smokeReportPath,
  });
  if (!bundleValidation.valid) {
    failures.push(bundleValidation.reason);
  }

  return checkResult({
    id: 'release-smoke-evidence-bundle-contract',
    passed: failures.length === 0,
    evidence:
      'Smoke releases include a self-contained smoke-evidence-bundle.json with embedded target-specific private delivery proof.',
    failMessage: `Release smoke evidence bundle contract failed: ${failures.join('; ')}`,
  });
}

function validateSmokeEvidenceBundle({ manifest, projectRoot, releaseRoot, smokeEvidenceBundle, smokeReportPath }) {
  if (!smokeEvidenceBundle || typeof smokeEvidenceBundle !== 'object') {
    return { valid: false, reason: 'smoke-evidence-bundle.json: missing or invalid JSON.' };
  }

  const failures = [];
  if (smokeEvidenceBundle.bundleVersion !== SMOKE_EVIDENCE_BUNDLE_VERSION) {
    failures.push(`bundleVersion must be ${SMOKE_EVIDENCE_BUNDLE_VERSION}`);
  }
  if (smokeEvidenceBundle.product !== 'sdkwork-video-cut') {
    failures.push('product must be sdkwork-video-cut');
  }
  if (smokeEvidenceBundle.action !== manifest?.action || smokeEvidenceBundle.target !== manifest?.target) {
    failures.push('action/target must match release manifest');
  }
  if (smokeEvidenceBundle.status !== manifest?.status || smokeEvidenceBundle.status !== 'pass') {
    failures.push('status must be pass and match release manifest');
  }
  if (smokeEvidenceBundle.smokeReportPath !== smokeReportPath) {
    failures.push('smokeReportPath must match action and quality evidence');
  }
  if (smokeEvidenceBundle.validation?.status !== 'pass' || smokeEvidenceBundle.validation?.reason !== '') {
    failures.push('validation must be pass with empty reason');
  }
  if (!/^[a-f0-9]{64}$/.test(String(smokeEvidenceBundle.sha256 ?? ''))) {
    failures.push('sha256 must be SHA-256');
  }
  if (!Number.isInteger(smokeEvidenceBundle.sizeBytes) || smokeEvidenceBundle.sizeBytes <= 0) {
    failures.push('sizeBytes must be positive');
  }
  if (reportContainsSensitiveData(smokeEvidenceBundle) || findLocalAbsolutePath(smokeEvidenceBundle)) {
    failures.push('bundle contains sensitive data or local paths');
  }

  if (typeof smokeReportPath === 'string' && isSafeRelativePath(smokeReportPath)) {
    const smokeReportFile = resolveArtifactPath({
      artifactPath: smokeReportPath,
      projectRoot,
      releaseRoot,
    });
    if (!existsSync(smokeReportFile)) {
      failures.push(`${smokeReportPath}: smoke report file is missing from project evidence`);
    } else {
      const bytes = readFileSync(smokeReportFile);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== smokeEvidenceBundle.sha256 || bytes.length !== smokeEvidenceBundle.sizeBytes) {
        failures.push('hash/size drifted from project smoke report evidence');
      }

      let report;
      try {
        report = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        failures.push(`project smoke report JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (report) {
        if (!deepEqual(smokeEvidenceBundle.report, report)) {
          failures.push('embedded report does not match project smoke report evidence');
        }
        if (smokeEvidenceBundle.reportVersion !== report.reportVersion) {
          failures.push('reportVersion must match embedded report');
        }
        if (smokeEvidenceBundle.ok !== report.ok) {
          failures.push('ok must match embedded report');
        }
        if (!deepEqual(smokeEvidenceBundle.summary, report.summary ?? {})) {
          failures.push('summary must match embedded report');
        }
        const reportValidation = validateSmokeReportObject(manifest?.target, report);
        if (!reportValidation.valid) {
          failures.push(reportValidation.reason);
        }
        const evidenceValidation = validateSmokeEvidenceSummary(manifest?.target, smokeEvidenceBundle.evidence, report);
        if (!evidenceValidation.valid) {
          failures.push(evidenceValidation.reason);
        }
      }
    }
  }

  return failures.length === 0
    ? { valid: true, reason: '' }
    : { valid: false, reason: `smoke-evidence-bundle.json: ${failures.join(', ')}.` };
}

function validateSmokeReportObject(target, report) {
  const allowedVersions = SMOKE_REPORT_VERSIONS[target] ?? new Set();
  if (!allowedVersions.has(report?.reportVersion)) {
    return { valid: false, reason: `Smoke report version ${String(report?.reportVersion)} is not valid for ${target}.` };
  }

  if (report?.ok !== true || Number(report?.summary?.fail ?? 1) !== 0) {
    return { valid: false, reason: 'Smoke report must have ok=true and summary.fail=0.' };
  }

  if (reportContainsSensitiveData(report)) {
    return { valid: false, reason: 'Smoke report contains sensitive fields or credential-shaped values.' };
  }

  const localPathLeak = findLocalAbsolutePath(report);
  if (localPathLeak) {
    return { valid: false, reason: `Smoke report contains a server-local absolute path at ${localPathLeak}.` };
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

  return failedFields.length === 0
    ? { valid: true, reason: '' }
    : {
        valid: false,
        reason: `Web smoke report is missing required private browser delivery evidence: ${failedFields.join(', ')}.`,
      };
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

  return failedFields.length === 0
    ? { valid: true, reason: '' }
    : {
        valid: false,
        reason: `Server smoke report is missing required managed server evidence: ${failedFields.join(', ')}.`,
      };
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

  return failedFields.length === 0
    ? { valid: true, reason: '' }
    : {
        valid: false,
        reason: `HTTP workflow smoke report is missing required evidence: ${failedFields.join(', ')}.`,
      };
}

function validateSmokeEvidenceSummary(target, evidence, report) {
  if (target === 'web') {
    return validateWebSmokeEvidenceSummary(evidence, report);
  }
  if (target === 'server') {
    return validateManagedServerSmokeEvidenceSummary(evidence, report);
  }
  return validateHttpSmokeEvidenceSummary(target, evidence, report);
}

function validateWebSmokeEvidenceSummary(evidence, report) {
  const failures = [];
  if (evidence?.type !== 'managed-ui-private-browser-delivery') {
    failures.push('type=managed-ui-private-browser-delivery');
  }
  for (const field of REQUIRED_WEB_SMOKE_TRUE_FIELDS) {
    if (evidence?.requiredUiFields?.[field] !== true || valueAtPath(report, field) !== true) {
      failures.push(field);
    }
  }
  if (evidence?.localPathLeakVisible !== false || valueAtPath(report, 'ui.localPathLeakVisible') !== false) {
    failures.push('ui.localPathLeakVisible=false');
  }

  return failures.length === 0
    ? { valid: true, reason: '' }
    : { valid: false, reason: `Smoke evidence summary is missing web proof: ${failures.join(', ')}.` };
}

function validateManagedServerSmokeEvidenceSummary(evidence, report) {
  const failures = [];
  if (evidence?.type !== 'managed-server-private-workflow') {
    failures.push('type=managed-server-private-workflow');
  }
  if (evidence?.deploymentMode !== 'server-private' || report?.deploymentMode !== 'server-private') {
    failures.push('deploymentMode=server-private');
  }
  if (evidence?.runtime?.authMode !== 'single-user-token' || valueAtPath(report, 'runtime.authMode') !== 'single-user-token') {
    failures.push('runtime.authMode=single-user-token');
  }
  for (const checkId of REQUIRED_MANAGED_SERVER_CHECKS) {
    if (evidence?.managedChecks?.[checkId] !== true || !hasOkCheck(report, checkId)) {
      failures.push(checkId);
    }
  }

  const workflowEvidenceValidation = validateHttpSmokeEvidenceSummary('server', evidence?.workflow, valueAtPath(report, 'workflow'), {
    requireDeploymentMode: false,
  });
  if (!workflowEvidenceValidation.valid) {
    failures.push(workflowEvidenceValidation.reason);
  }

  return failures.length === 0
    ? { valid: true, reason: '' }
    : { valid: false, reason: `Smoke evidence summary is missing managed server proof: ${failures.join(', ')}.` };
}

function validateHttpSmokeEvidenceSummary(target, evidence, report, { requireDeploymentMode = true } = {}) {
  const failures = [];
  if (evidence?.type !== 'http-workflow-private-artifact-delivery') {
    failures.push('type=http-workflow-private-artifact-delivery');
  }
  if (requireDeploymentMode && evidence?.deploymentMode !== EXPECTED_SMOKE_DEPLOYMENT_MODES[target]) {
    failures.push(`deploymentMode=${EXPECTED_SMOKE_DEPLOYMENT_MODES[target]}`);
  }
  if (typeof evidence?.taskId !== 'string' || evidence.taskId.length === 0 || evidence.taskId !== report?.taskId) {
    failures.push('taskId');
  }
  for (const checkId of REQUIRED_HTTP_WORKFLOW_CHECKS) {
    if (evidence?.requiredChecks?.[checkId] !== true || !hasOkCheck(report, checkId)) {
      failures.push(checkId);
    }
  }
  for (const [field, expected] of [
    ['artifacts.output.downloadMode', 'host-content-endpoint'],
    ['artifacts.manifest.downloadMode', 'host-content-endpoint'],
    ['artifacts.log.downloadMode', 'host-content-endpoint'],
  ]) {
    if (valueAtPath(evidence, field) !== expected || valueAtPath(report, field) !== expected) {
      failures.push(`${field}=${expected}`);
    }
  }
  for (const field of [
    'artifacts.output.bytesChecked',
    'artifacts.output.rangeBytesChecked',
    'source.sizeBytes',
  ]) {
    if (Number(valueAtPath(evidence, field) ?? 0) <= 0 || Number(valueAtPath(report, field) ?? 0) <= 0) {
      failures.push(field);
    }
  }
  for (const field of [
    'artifacts.output.mp4Signature',
    'artifacts.output.rangeChecked',
    'artifacts.output.securityHeadersChecked',
  ]) {
    if (valueAtPath(evidence, field) !== true || valueAtPath(report, field) !== true) {
      failures.push(field);
    }
  }

  return failures.length === 0
    ? { valid: true, reason: '' }
    : { valid: false, reason: `Smoke evidence summary is missing HTTP workflow proof: ${failures.join(', ')}.` };
}

function checkReleaseProvenance({
  actionReport,
  manifest,
  normalizedReleaseAssetsDir,
  projectRoot,
  provenance,
  qualityReport,
  releaseRoot,
}) {
  const manifestArtifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const subjectArtifacts = manifestArtifacts.filter((artifact) => {
    return artifact?.path !== 'provenance.json' && artifact?.path !== 'release-signature.json';
  });
  const manifestArtifactPaths = new Set(manifestArtifacts.map((artifact) => artifact?.path));
  const failures = [];

  if (!provenance || typeof provenance !== 'object') {
    failures.push('provenance.json: missing or invalid JSON');
  } else {
    if (provenance.provenanceVersion !== PROVENANCE_VERSION) {
      failures.push(`provenanceVersion must be ${PROVENANCE_VERSION}`);
    }
    if (provenance.product !== 'sdkwork-video-cut') {
      failures.push('product must be sdkwork-video-cut');
    }
    if (provenance.action !== manifest?.action || provenance.target !== manifest?.target) {
      failures.push('action/target must match release manifest');
    }
    if (provenance.status !== manifest?.status || provenance.status !== 'pass') {
      failures.push('status must be pass and match release manifest');
    }
    if (provenance.generatedAt !== manifest?.generatedAt || provenance.generatedAt !== qualityReport?.generatedAt) {
      failures.push('generatedAt must match manifest and quality report');
    }
    if (provenance.releaseAssetsDir !== normalizedReleaseAssetsDir) {
      failures.push('releaseAssetsDir must match checked release assets directory');
    }
    if (!manifestArtifactPaths.has('provenance.json')) {
      failures.push('provenance.json must be listed in release manifest artifacts');
    }

    const expectedSubjectHash = createHash('sha256').update(JSON.stringify(subjectArtifacts)).digest('hex');
    if (provenance.subject?.artifactCount !== subjectArtifacts.length) {
      failures.push('subject.artifactCount must match manifest artifact count excluding provenance.json and release-signature.json');
    }
    if (provenance.subject?.artifactManifestSha256 !== expectedSubjectHash) {
      failures.push('subject.artifactManifestSha256 must match manifest artifacts excluding provenance.json and release-signature.json');
    }
    if (!deepEqual(provenance.subject?.artifacts, subjectArtifacts)) {
      failures.push('subject.artifacts must equal manifest artifacts excluding provenance.json and release-signature.json');
    }

    const packageJson = readPackageJson(projectRoot);
    if (provenance.package?.name !== packageJson.name) {
      failures.push('package.name must match package.json');
    }
    if (provenance.package?.version !== packageJson.version) {
      failures.push('package.version must match package.json');
    }
    if ((provenance.package?.packageManager ?? '') !== (packageJson.packageManager ?? '')) {
      failures.push('package.packageManager must match package.json');
    }
    if (typeof provenance.buildEnvironment?.node !== 'string' || !provenance.buildEnvironment.node.startsWith('v')) {
      failures.push('buildEnvironment.node must record a Node runtime version');
    }
    if (typeof provenance.buildEnvironment?.platform !== 'string' || provenance.buildEnvironment.platform.length === 0) {
      failures.push('buildEnvironment.platform must be present');
    }
    if (typeof provenance.buildEnvironment?.arch !== 'string' || provenance.buildEnvironment.arch.length === 0) {
      failures.push('buildEnvironment.arch must be present');
    }
    if (typeof provenance.git?.available !== 'boolean') {
      failures.push('git.available must be boolean');
    }
    if (provenance.git?.commit && !/^[a-f0-9]{40}$/.test(String(provenance.git.commit))) {
      failures.push('git.commit must be a full SHA-1 when available');
    }
    if (typeof provenance.git?.dirty !== 'boolean') {
      failures.push('git.dirty must be boolean');
    }
    if (
      provenance.git?.statusSha256 &&
      !/^[a-f0-9]{64}$/.test(String(provenance.git.statusSha256))
    ) {
      failures.push('git.statusSha256 must be SHA-256 when present');
    }

    const standardArtifactValidations = [
      ['governance-evidence-bundle.json', resolve(releaseRoot, 'governance-evidence-bundle.json')],
      ...(manifest?.action === 'smoke'
        ? [['smoke-evidence-bundle.json', resolve(releaseRoot, 'smoke-evidence-bundle.json')]]
        : []),
      ['sdkwork-video-cut-sbom.cdx.json', resolve(releaseRoot, 'sdkwork-video-cut-sbom.cdx.json')],
      ['release-notes.md', resolve(releaseRoot, 'release-notes.md')],
      [
        'quality-gate-execution-report.json',
        resolve(releaseRoot, 'quality-gate-execution-report.json'),
      ],
    ];
    for (const [key, absolutePath] of standardArtifactValidations) {
      const validation = validateProvenanceArtifactProof(provenance.standardArtifacts?.[key], absolutePath, key);
      if (!validation.valid) {
        failures.push(validation.reason);
      }
    }

    const actionReportKey =
      typeof manifest?.target === 'string' && typeof manifest?.action === 'string'
        ? `${manifest.target}-${manifest.action}-report.json`
        : '';
    const actionReportProof = provenance.standardArtifacts?.[actionReportKey];
    if (!actionReportProof) {
      failures.push(`${actionReportKey}: missing from provenance standardArtifacts`);
    } else if (!isSafeRelativePath(actionReportProof.path)) {
      failures.push(`${actionReportKey}: path must be project-relative`);
    } else if (actionReportProof.path !== actionReport?.value?.actionReportPath) {
      failures.push(`${actionReportKey}: path must match action report path`);
    } else {
      const validation = validateProvenanceArtifactProof(
        actionReportProof,
        resolve(releaseRoot, actionReportKey),
        actionReportKey,
      );
      if (!validation.valid) {
        failures.push(validation.reason);
      }
    }

    if (reportContainsSensitiveData(provenance) || findLocalAbsolutePath(provenance)) {
      failures.push('provenance contains sensitive data or local paths');
    }
  }

  return checkResult({
    id: 'release-provenance-contract',
    passed: failures.length === 0,
    evidence:
      'provenance.json records product, release target, build environment, package metadata, git digest, and manifest subject hash.',
    failMessage: `Release provenance contract failed: ${failures.join('; ')}`,
  });
}

function validateProvenanceArtifactProof(proof, absolutePath, key) {
  if (!proof || typeof proof !== 'object') {
    return { valid: false, reason: `${key}: missing from provenance standardArtifacts` };
  }
  if (!isSafeRelativePath(proof.path)) {
    return { valid: false, reason: `${key}: provenance path must be project-relative` };
  }
  if (proof.path !== key && !String(proof.path ?? '').endsWith(`/${key}`)) {
    return { valid: false, reason: `${key}: provenance path mismatch` };
  }
  if (!existsSync(absolutePath)) {
    return { valid: false, reason: `${key}: file missing from release package` };
  }
  const bytes = readFileSync(absolutePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (proof.sha256 !== sha256 || proof.sizeBytes !== bytes.length) {
    return { valid: false, reason: `${key}: provenance hash/size mismatch` };
  }
  return { valid: true, reason: '' };
}

function checkReleaseSignature({
  actionReport,
  checksumsText,
  manifest,
  normalizedReleaseAssetsDir,
  projectRoot,
  qualityReport,
  releaseRoot,
  signature,
}) {
  const manifestArtifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const signedArtifacts = manifestArtifacts.filter((artifact) => artifact?.path !== 'release-signature.json');
  const manifestArtifactPaths = new Set(manifestArtifacts.map((artifact) => artifact?.path));
  const failures = [];

  if (!signature || typeof signature !== 'object') {
    failures.push('release-signature.json: missing or invalid JSON');
  } else {
    if (signature.signatureVersion !== RELEASE_SIGNATURE_VERSION) {
      failures.push(`signatureVersion must be ${RELEASE_SIGNATURE_VERSION}`);
    }
    if (signature.product !== 'sdkwork-video-cut') {
      failures.push('product must be sdkwork-video-cut');
    }
    if (signature.action !== manifest?.action || signature.target !== manifest?.target) {
      failures.push('action/target must match release manifest');
    }
    if (signature.status !== manifest?.status || signature.status !== 'pass') {
      failures.push('status must be pass and match release manifest');
    }
    if (signature.releaseAssetsDir !== normalizedReleaseAssetsDir) {
      failures.push('releaseAssetsDir must match checked release assets directory');
    }
    if (signature.signatureKind !== 'local-deterministic-digest') {
      failures.push('signatureKind must be local-deterministic-digest');
    }
    if (!manifestArtifactPaths.has('release-signature.json')) {
      failures.push('release-signature.json must be listed in release manifest artifacts');
    }

    const payload = signature.payload;
    if (payload?.algorithm !== 'sha256') {
      failures.push('payload.algorithm must be sha256');
    }
    const expectedSubjectHash = createHash('sha256').update(JSON.stringify(signedArtifacts)).digest('hex');
    if (payload?.subjectManifestSha256 !== expectedSubjectHash) {
      failures.push('payload.subjectManifestSha256 must match manifest artifacts excluding release-signature.json');
    }
    const manifestSubject = createReleaseManifestSignatureSubject(manifest, signedArtifacts);
    const checksumsSubject = signedArtifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join('\n');
    const expectedSignedFiles = [
      releaseSignatureTextSubject(
        JSON.stringify(manifestSubject),
        `${normalizedReleaseAssetsDir}/release-manifest.json`,
        'release-manifest-subject',
      ),
      releaseSignatureTextSubject(
        checksumsSubject,
        `${normalizedReleaseAssetsDir}/SHA256SUMS.txt`,
        'sha256sums-subject',
      ),
      releaseSignatureFileSubject(resolve(releaseRoot, 'provenance.json'), `${normalizedReleaseAssetsDir}/provenance.json`, 'provenance'),
      releaseSignatureFileSubject(
        resolve(releaseRoot, 'release-notes.md'),
        `${normalizedReleaseAssetsDir}/release-notes.md`,
        'release-notes',
      ),
      releaseSignatureFileSubject(
        resolve(releaseRoot, 'quality-gate-execution-report.json'),
        `${normalizedReleaseAssetsDir}/quality-gate-execution-report.json`,
        'quality-gate-report',
      ),
      releaseSignatureFileSubject(
        resolve(releaseRoot, `${manifest?.target}-${manifest?.action}-report.json`),
        actionReport?.value?.actionReportPath ?? `${normalizedReleaseAssetsDir}/${manifest?.target}-${manifest?.action}-report.json`,
        'action-report',
      ),
    ];
    if (!deepEqual(payload?.signedFiles, expectedSignedFiles)) {
      failures.push('payload.signedFiles must match release manifest, SHA256SUMS, provenance, release-notes.md, quality report, and action report');
    }
    const expectedSignature = createHash('sha256')
      .update(
        JSON.stringify({
          algorithm: 'sha256',
          subjectManifestSha256: expectedSubjectHash,
          signedFiles: expectedSignedFiles,
        }),
      )
      .digest('hex');
    if (signature.signature !== expectedSignature) {
      failures.push('signature must match deterministic digest payload');
    }
    if (signature.verification?.command !== 'check:release-contracts') {
      failures.push('verification.command must be check:release-contracts');
    }
    if (signature.verification?.contract !== 'release-signature-contract') {
      failures.push('verification.contract must be release-signature-contract');
    }
    if (reportContainsSensitiveData(signature) || findLocalAbsolutePath(signature)) {
      failures.push('release-signature contains sensitive data or local paths');
    }
  }

  return checkResult({
    id: 'release-signature-contract',
    passed: failures.length === 0,
    evidence:
      'release-signature.json seals manifest, SHA256SUMS, provenance, release-notes.md, quality report, and action report with a deterministic digest.',
    failMessage: `Release signature contract failed: ${failures.join('; ')}`,
  });
}

function releaseSignatureFileSubject(absolutePath, path, role) {
  if (!existsSync(absolutePath)) {
    return {
      role,
      path,
      sha256: '',
      sizeBytes: 0,
    };
  }
  const bytes = readFileSync(absolutePath);
  return {
    role,
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}

function createReleaseManifestSignatureSubject(manifest, subjectArtifacts) {
  return {
    manifestVersion: manifest?.manifestVersion,
    product: manifest?.product,
    action: manifest?.action,
    target: manifest?.target,
    runtimeProfile: manifest?.runtimeProfile,
    contractVersions: manifest?.contractVersions,
    status: manifest?.status,
    generatedAt: manifest?.generatedAt,
    artifacts: subjectArtifacts,
  };
}

function releaseSignatureTextSubject(text, path, role) {
  const bytes = Buffer.from(String(text ?? ''), 'utf8');
  return {
    role,
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}

function checkSbom(sbom) {
  const failures = [];
  if (sbom?.bomFormat !== 'CycloneDX') {
    failures.push('bomFormat=CycloneDX');
  }
  if (sbom?.specVersion !== '1.6') {
    failures.push('specVersion=1.6');
  }
  if (sbom?.metadata?.component?.name !== '@sdkwork/video-cut') {
    failures.push('metadata.component.name=@sdkwork/video-cut');
  }
  if (!Array.isArray(sbom?.components) || sbom.components.length === 0) {
    failures.push('components');
  }
  if (reportContainsSensitiveData(sbom) || findLocalAbsolutePath(sbom)) {
    failures.push('redaction');
  }

  return checkResult({
    id: 'release-sbom-contract',
    passed: failures.length === 0,
    evidence: 'sdkwork-video-cut-sbom.cdx.json is a CycloneDX 1.6 application SBOM with dependency components.',
    failMessage: `SBOM contract drift: ${failures.join(', ')}`,
  });
}

function validateGovernanceReport(projectRoot, definition, releaseRoot = undefined) {
  const path = releaseRoot
    ? resolveArtifactPath({
        artifactPath: definition.path,
        projectRoot,
        releaseRoot,
      })
    : resolve(projectRoot, definition.path);
  if (!existsSync(path)) {
    return { valid: false, reason: `${definition.path}: governance report is missing.` };
  }

  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      valid: false,
      reason: `${definition.path}: unable to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (report?.reportVersion !== definition.reportVersion) {
    return { valid: false, reason: `${definition.path}: reportVersion must be ${definition.reportVersion}.` };
  }
  if (report?.command !== definition.command) {
    return { valid: false, reason: `${definition.path}: command must be ${definition.command}.` };
  }
  if (report?.status !== 'pass') {
    return { valid: false, reason: `${definition.path}: status must be pass.` };
  }
  if (report?.reportPath !== definition.path) {
    return { valid: false, reason: `${definition.path}: reportPath must be ${definition.path}.` };
  }
  if (Number(report?.summary?.fail ?? 0) !== 0) {
    return { valid: false, reason: `${definition.path}: summary.fail must be 0.` };
  }
  if (Number(report?.summary?.blockingFailures ?? 0) !== 0 || Number(report?.summary?.gaps ?? 0) !== 0) {
    return { valid: false, reason: `${definition.path}: feature readiness gaps/blockingFailures must be 0.` };
  }
  if (reportContainsSensitiveData(report)) {
    return { valid: false, reason: `${definition.path}: contains sensitive data.` };
  }
  const localPathLeak = findLocalAbsolutePath(report);
  if (localPathLeak) {
    return { valid: false, reason: `${definition.path}: contains local absolute path at ${localPathLeak}.` };
  }

  return { valid: true, reason: '' };
}

function hasOkCheck(report, checkId) {
  return Array.isArray(report?.checks) && report.checks.some((check) => check?.checkId === checkId && check?.status === 'ok');
}

function valueAtPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
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

function readTextFile(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function readPackageJson(projectRoot) {
  try {
    return JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function listReleasePackageFiles(releaseRoot) {
  const files = new Set();
  if (!existsSync(releaseRoot)) {
    return files;
  }

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
      files.add(normalizeProjectPath(relative(releaseRoot, absolutePath)));
    }
  };

  visit(releaseRoot);
  return files;
}

function resolveArtifactPath({ artifactPath, projectRoot, releaseRoot }) {
  if (
    artifactPath === 'sdkwork-video-cut-sbom.cdx.json' ||
    artifactPath === 'governance-evidence-bundle.json' ||
    artifactPath === 'smoke-evidence-bundle.json' ||
    artifactPath === 'provenance.json' ||
    artifactPath === 'release-signature.json'
  ) {
    return resolve(releaseRoot, artifactPath);
  }

  const releaseCandidate = resolve(releaseRoot, artifactPath);
  if (existsSync(releaseCandidate)) {
    return releaseCandidate;
  }

  return resolve(projectRoot, artifactPath);
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

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printHumanReport(report) {
  const lines = [
    'SDKWork Video Cut Release Contracts',
    `releaseAssetsDir: ${report.releaseAssetsDir}`,
    `action: ${report.action}`,
    `target: ${report.target}`,
    `status: ${report.status}`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    '',
    ...report.checks.map((check) => `${check.status.toUpperCase()} ${check.id}: ${check.evidence}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}
