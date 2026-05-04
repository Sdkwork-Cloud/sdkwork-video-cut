#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createReportPath } from './lib/report-paths.mjs';
import { normalizeCliArgs } from './lib/cli-args.mjs';

const REPORT_VERSION = 'video-cut.cli-contracts-report.v1';
const COMMAND = 'check:cli-contracts';
const DEFAULT_REPORT_DIR = 'artifacts/governance';

const REQUIRED_PACKAGE_SCRIPTS = {
  'check:cli-contracts': 'node scripts/check-video-cut-cli-contracts.mjs',
  'check:contracts': 'node scripts/check-video-cut-openapi-contracts.mjs',
  'check:database-contracts': 'node scripts/check-video-cut-database-contracts.mjs',
  'check:deployment-artifacts': 'node scripts/check-video-cut-deployment-artifacts.mjs',
  'check:deployment-matrix': 'node scripts/check-video-cut-deployment-matrix.mjs',
  'check:feature-readiness': 'node scripts/check-video-cut-feature-readiness.mjs',
  'check:feature-readiness-policy': 'node scripts/check-video-cut-feature-readiness-policy.mjs',
  'check:governance': 'node scripts/check-video-cut-governance-suite.mjs all',
  'check:release-contracts': 'node scripts/check-video-cut-release-contracts.mjs',
  'check:release-smoke-readiness': 'node scripts/check-video-cut-release-smoke-readiness.mjs',
  'verify:release-signature': 'node scripts/verify-video-cut-release-signature.mjs',
  'check:smoke-evidence': 'node scripts/check-video-cut-smoke-evidence-contracts.mjs',
  'deployment:doctor': 'node scripts/run-video-cut-deployment-doctor.mjs desktop-dev --deployment-mode desktop-local',
  'workflow:smoke': 'node scripts/run-video-cut-http-workflow-smoke.mjs desktop-dev --deployment-mode desktop-local',
  'workflow:smoke:server:managed':
    'node scripts/run-video-cut-managed-server-smoke.mjs server-dev --deployment-mode server-private',
  'workflow:smoke:ui:managed':
    'node scripts/run-video-cut-managed-ui-smoke.mjs server-dev --deployment-mode server-private',
  'release:ready': 'node scripts/release/run-release-ready.mjs',
  'release:package:container': 'node scripts/release/run-release-with-governance.mjs package container',
  'release:package:matrix': 'node scripts/release/run-release-matrix.mjs',
  'release:smoke:preflight': 'node scripts/release/check-release-smoke-preflight.mjs',
  'release:smoke:matrix': 'node scripts/release/run-release-smoke-matrix.mjs',
  'release:smoke:ready': 'node scripts/release/run-release-smoke-ready.mjs',
};

const CLI_MODULES = [
  {
    id: 'governance-cli',
    modulePath: './check-video-cut-governance-suite.mjs',
    parser: 'parseGovernanceArgs',
    args: ['license', '--', '--json'],
    expected: { category: 'license', json: true, reportDir: DEFAULT_REPORT_DIR },
  },
  {
    id: 'deployment-artifacts-cli',
    modulePath: './check-video-cut-deployment-artifacts.mjs',
    parser: 'parseDeploymentArtifactsArgs',
    args: ['--', '--json', '--report-dir', 'artifacts/deployment'],
    expected: { json: true, reportDir: 'artifacts/deployment' },
  },
  {
    id: 'openapi-contracts-cli',
    modulePath: './check-video-cut-openapi-contracts.mjs',
    parser: 'parseOpenApiContractsArgs',
    args: ['--', '--json', '--report-dir', 'artifacts/openapi'],
    expected: { json: true, reportDir: 'artifacts/openapi' },
  },
  {
    id: 'deployment-matrix-cli',
    modulePath: './check-video-cut-deployment-matrix.mjs',
    parser: 'parseMatrixArgs',
    args: ['--', '--json'],
    expected: { json: true, reportDir: DEFAULT_REPORT_DIR },
  },
  {
    id: 'feature-readiness-cli',
    modulePath: './check-video-cut-feature-readiness.mjs',
    parser: 'parseFeatureReadinessArgs',
    args: ['--', '--json'],
    expected: {
      json: true,
      registryPath: 'docs/product/feature-readiness.yaml',
      reportDir: DEFAULT_REPORT_DIR,
    },
  },
  {
    id: 'feature-readiness-policy-cli',
    modulePath: './check-video-cut-feature-readiness-policy.mjs',
    parser: 'parseFeatureReadinessPolicyArgs',
    args: ['--', '--json', '--registry', 'docs/product/feature-readiness.yaml', '--report-dir', 'artifacts/readiness-policy'],
    expected: {
      json: true,
      registryPath: 'docs/product/feature-readiness.yaml',
      reportDir: 'artifacts/readiness-policy',
    },
  },
  {
    id: 'database-contracts-cli',
    modulePath: './check-video-cut-database-contracts.mjs',
    parser: 'parseDatabaseContractsArgs',
    args: ['--', '--json'],
    expected: { json: true, reportDir: DEFAULT_REPORT_DIR },
  },
  {
    id: 'deployment-doctor-cli',
    modulePath: './run-video-cut-deployment-doctor.mjs',
    parser: 'parseDoctorArgs',
    args: ['--', 'server-dev', '--deployment-mode', 'server-private', '--json'],
    expectedSubset: { deploymentMode: 'server-private', json: true, profile: 'server-dev' },
  },
  {
    id: 'http-workflow-smoke-cli',
    modulePath: './run-video-cut-http-workflow-smoke.mjs',
    parser: 'parseHttpWorkflowSmokeArgs',
    args: ['--', 'server-dev', '--deployment-mode', 'server-private', '--json'],
    expectedSubset: { deploymentMode: 'server-private', json: true, profile: 'server-dev' },
  },
  {
    id: 'managed-server-smoke-cli',
    modulePath: './run-video-cut-managed-server-smoke.mjs',
    parser: 'parseManagedServerSmokeArgs',
    args: ['--', 'server-dev', '--deployment-mode', 'server-private', '--json'],
    expectedSubset: { deploymentMode: 'server-private', json: true, profile: 'server-dev' },
  },
  {
    id: 'managed-ui-smoke-cli',
    modulePath: './run-video-cut-managed-ui-smoke.mjs',
    parser: 'parseManagedUiSmokeArgs',
    args: ['--', 'server-dev', '--deployment-mode', 'server-private', '--json'],
    expectedSubset: { deploymentMode: 'server-private', json: true, profile: 'server-dev' },
  },
  {
    id: 'release-command-cli',
    modulePath: './release/local-release-command.mjs',
    parser: 'parseReleaseArgs',
    args: ['package', 'container', '--', '--json', '--report-dir', 'artifacts/governance/release-matrix/container'],
    expected: {
      action: 'package',
      json: true,
      releaseAssetsDir: 'artifacts/release',
      reportDir: 'artifacts/governance/release-matrix/container',
      target: 'container',
    },
  },
  {
    id: 'release-contracts-cli',
    modulePath: './check-video-cut-release-contracts.mjs',
    parser: 'parseReleaseContractsArgs',
    args: ['--', '--json', '--release-assets-dir', 'artifacts/release-contract-check'],
    expected: {
      json: true,
      releaseAssetsDir: 'artifacts/release-contract-check',
      reportDir: 'artifacts/governance',
    },
  },
  {
    id: 'smoke-evidence-contracts-cli',
    modulePath: './check-video-cut-smoke-evidence-contracts.mjs',
    parser: 'parseSmokeEvidenceContractsArgs',
    args: ['--', '--json', '--report-dir', 'artifacts/smoke-evidence'],
    expected: { json: true, reportDir: 'artifacts/smoke-evidence', smokeReports: [], strict: false },
  },
  {
    id: 'release-smoke-readiness-cli',
    modulePath: './check-video-cut-release-smoke-readiness.mjs',
    parser: 'parseReleaseSmokeReadinessArgs',
    args: [
      '--',
      '--json',
      '--preflight-report',
      'artifacts/governance/release-smoke-preflight-report.json',
      '--matrix-report',
      'artifacts/governance/release-smoke-matrix-report.json',
      '--report-dir',
      'artifacts/smoke-readiness',
      '--require-ready',
    ],
    expected: {
      json: true,
      requireReady: true,
      preflightReportPath: 'artifacts/governance/release-smoke-preflight-report.json',
      matrixReportPath: 'artifacts/governance/release-smoke-matrix-report.json',
      reportDir: 'artifacts/smoke-readiness',
    },
  },
  {
    id: 'release-signature-verifier-cli',
    modulePath: './verify-video-cut-release-signature.mjs',
    parser: 'parseReleaseSignatureVerificationArgs',
    args: ['--', '--json', '--release-assets-dir', 'artifacts/release-candidate', '--report-dir', 'artifacts/verify'],
    expected: {
      json: true,
      releaseAssetsDir: 'artifacts/release-candidate',
      reportDir: 'artifacts/verify',
    },
  },
  {
    id: 'release-package-governance-cli',
    modulePath: './release/run-release-with-governance.mjs',
    parser: 'parseReleaseWithGovernanceArgs',
    args: ['package', 'container', '--', '--json'],
    expected: {
      action: 'package',
      json: true,
      releaseAssetsDir: 'artifacts/release',
      reportDir: 'artifacts/governance',
      target: 'container',
    },
  },
  {
    id: 'release-smoke-governance-cli',
    modulePath: './release/run-release-with-governance.mjs',
    parser: 'parseReleaseWithGovernanceArgs',
    args: ['smoke', 'container', '--', '--smoke-report', 'artifacts/release/smoke/container-smoke-report.json', '--json'],
    expected: {
      action: 'smoke',
      json: true,
      releaseAssetsDir: 'artifacts/release',
      reportDir: 'artifacts/governance',
      smokeReportPath: 'artifacts/release/smoke/container-smoke-report.json',
      target: 'container',
    },
  },
  {
    id: 'release-matrix-cli',
    modulePath: './release/run-release-matrix.mjs',
    parser: 'parseReleaseMatrixArgs',
    args: ['--', '--json', '--release-assets-dir', 'artifacts/release-train'],
    expected: {
      json: true,
      releaseAssetsDir: 'artifacts/release-train',
      reportDir: 'artifacts/governance',
    },
  },
  {
    id: 'release-ready-cli',
    modulePath: './release/run-release-ready.mjs',
    parser: 'parseReleaseReadyArgs',
    args: [
      '--',
      '--json',
      '--release-assets-dir',
      'artifacts/release-ready/packages',
      '--smoke-release-assets-dir',
      'artifacts/release-ready/smoke',
      '--report-dir',
      'artifacts/release-ready/governance',
      '--smoke-report-dir',
      'artifacts/release-ready/smoke/reports',
      '--ffmpeg-path',
      'tools/ffmpeg/bin/ffmpeg',
      '--cargo-path',
      'tools/rust/bin/cargo',
      '--chrome-executable-path',
      'tools/chrome/chrome',
      '--bind-host',
      '127.0.0.2',
      '--timeout-ms',
      '45000',
    ],
    expected: {
      bindHost: '127.0.0.2',
      cargoPath: 'tools/rust/bin/cargo',
      chromeExecutablePath: 'tools/chrome/chrome',
      ffmpegPath: 'tools/ffmpeg/bin/ffmpeg',
      json: true,
      releaseAssetsDir: 'artifacts/release-ready/packages',
      smokeReleaseAssetsDir: 'artifacts/release-ready/smoke',
      reportDir: 'artifacts/release-ready/governance',
      smokeReportDir: 'artifacts/release-ready/smoke/reports',
      timeoutMs: 45000,
    },
  },
  {
    id: 'release-smoke-preflight-cli',
    modulePath: './release/check-release-smoke-preflight.mjs',
    parser: 'parseReleaseSmokePreflightArgs',
    args: ['--', '--json', '--release-assets-dir', 'artifacts/smoke-train', '--report-dir', 'artifacts/preflight'],
    expectedSubset: {
      bindHost: '127.0.0.1',
      ffmpegPath: 'ffmpeg',
      json: true,
      releaseAssetsDir: 'artifacts/smoke-train',
      reportDir: 'artifacts/preflight',
      smokeReportDir: 'artifacts/smoke-train/smoke',
    },
  },
  {
    id: 'release-smoke-matrix-cli',
    modulePath: './release/run-release-smoke-matrix.mjs',
    parser: 'parseReleaseSmokeMatrixArgs',
    args: [
      '--',
      '--json',
      '--release-assets-dir',
      'artifacts/smoke-train',
      '--ffmpeg-path',
      'tools/ffmpeg/bin/ffmpeg',
      '--cargo-path',
      'tools/rust/bin/cargo',
      '--chrome-executable-path',
      'tools/chrome/chrome',
      '--bind-host',
      '127.0.0.2',
      '--timeout-ms',
      '45000',
    ],
    expected: {
      bindHost: '127.0.0.2',
      cargoPath: 'tools/rust/bin/cargo',
      chromeExecutablePath: 'tools/chrome/chrome',
      ffmpegPath: 'tools/ffmpeg/bin/ffmpeg',
      json: true,
      releaseAssetsDir: 'artifacts/smoke-train',
      reportDir: 'artifacts/governance',
      smokeReportDir: 'artifacts/smoke-train/smoke',
      timeoutMs: 45000,
    },
  },
  {
    id: 'release-smoke-ready-cli',
    modulePath: './release/run-release-smoke-ready.mjs',
    parser: 'parseReleaseSmokeReadyArgs',
    args: [
      '--',
      '--json',
      '--release-assets-dir',
      'artifacts/smoke-ready',
      '--report-dir',
      'artifacts/smoke-ready-governance',
      '--smoke-report-dir',
      'artifacts/smoke-ready/smoke',
      '--ffmpeg-path',
      'tools/ffmpeg/bin/ffmpeg',
      '--cargo-path',
      'tools/rust/bin/cargo',
      '--chrome-executable-path',
      'tools/chrome/chrome',
      '--bind-host',
      '127.0.0.2',
      '--timeout-ms',
      '45000',
    ],
    expected: {
      bindHost: '127.0.0.2',
      cargoPath: 'tools/rust/bin/cargo',
      chromeExecutablePath: 'tools/chrome/chrome',
      ffmpegPath: 'tools/ffmpeg/bin/ffmpeg',
      json: true,
      releaseAssetsDir: 'artifacts/smoke-ready',
      reportDir: 'artifacts/smoke-ready-governance',
      smokeReportDir: 'artifacts/smoke-ready/smoke',
      timeoutMs: 45000,
    },
  },
];

export function parseCliContractsArgs(argv) {
  const args = normalizeCliArgs(argv);
  let json = false;
  let reportDir = DEFAULT_REPORT_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--report-dir') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--report-dir requires a value.');
      }
      reportDir = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown CLI contracts argument: ${arg}`);
  }

  return { json, reportDir };
}

export async function createCliContractsReport({ projectRoot = process.cwd(), reportDir = DEFAULT_REPORT_DIR } = {}) {
  const checks = [
    checkPackageScripts(projectRoot),
    checkCliArgsHelper(),
    await checkReportSafetyHelper(),
    await checkBrowserChildProcessEnvSanitizer(),
    ...(await checkCliModules()),
    await checkReportWriters(projectRoot),
  ];
  const summary = summarizeChecks(checks);
  const { absolutePath, reportPath } = createReportPath(projectRoot, reportDir, 'cli-contracts-report.json');
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
  const options = parseCliContractsArgs(process.argv.slice(2));
  const report = await createCliContractsReport({ reportDir: options.reportDir });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === 'pass' ? 0 : 1;
}

function checkPackageScripts(projectRoot) {
  const packageJson = readJson(projectRoot, 'package.json');
  const missingOrDrifted = Object.entries(REQUIRED_PACKAGE_SCRIPTS)
    .filter(([name, command]) => packageJson.scripts?.[name] !== command)
    .map(([name]) => name);

  return checkResult({
    id: 'cli-package-scripts',
    passed: missingOrDrifted.length === 0,
    evidence: Object.keys(REQUIRED_PACKAGE_SCRIPTS).join(', '),
    failMessage: `CLI package scripts missing or drifted: ${missingOrDrifted.join(', ')}`,
  });
}

function checkCliArgsHelper() {
  const actual = normalizeCliArgs(['alpha', '--', '--json', '--', 'omega']);
  return checkResult({
    id: 'pnpm-argument-separator-compatibility',
    passed: JSON.stringify(actual) === JSON.stringify(['alpha', '--json', 'omega']),
    evidence: 'Bare pnpm -- separators are stripped before CLI-specific parsing.',
    failMessage: `normalizeCliArgs must strip bare -- separators. Actual: ${JSON.stringify(actual)}`,
  });
}

async function checkReportSafetyHelper() {
  try {
    const {
      findLocalAbsolutePath,
      isLocalAbsolutePath,
      redactReport,
      reportContainsSensitiveData,
      sanitizeErrorMessage,
    } = await import('./lib/report-safety.mjs');
    const unsafe = {
      authToken: 'browser-token',
      error: new Error('failure at D:\\private\\workspace with Bearer report-secret-token and sk-live-report-safety-secret'),
      nested: {
        path: 'prefix /Users/operator/video-cut/workspace suffix',
      },
    };
    const unsafeCredentialShapes = [
      { Authorization: 'Basic b3BlcmF0b3I6c2VjcmV0' },
      { headers: { 'X-Api-Key': 'provider-header-secret' } },
      { query: 'https://provider.example.test/v1/models?api_key=provider-query-secret' },
      { url: 'https://provider.example.test/v1/tasks?access_token=provider-access-secret' },
      { nested: { RefreshToken: 'refresh-token-secret' } },
    ];
    const safeStatusEvidence = {
      apiKeyConfigured: true,
      artifactContentAuthorizationVerified: true,
      credentialStatus: 'configured',
      message: 'ApiSuccessEnvelope and ApiErrorEnvelope declare stable ok/data and ok/error contracts.',
    };
    const redactedReport = redactReport({
      apiKey: 'sk-live-redact-report-secret',
      authorization: 'Bearer redact-report-secret-token',
      nested: {
        authToken: 'nested-auth-token',
        artifactPath: 'D:\\private\\workspace\\source.mp4',
        safeStatus: {
          apiKeyConfigured: true,
          credentialStatus: 'configured',
        },
      },
    });
    const redactedKnownSecretReport = redactReport(
      {
        details: 'runtime token known-runtime-token leaked through a non-secret-shaped field',
        nested: {
          echo: 'known-runtime-token',
        },
      },
      ['known-runtime-token'],
    );
    const sanitized = sanitizeErrorMessage(unsafe.error);
    const sanitizedCredentialMessage = sanitizeErrorMessage(
      'provider call failed with Authorization: Basic b3BlcmF0b3I6c2VjcmV0, X-Api-Key: provider-header-secret and https://provider.example.test/v1?api_key=provider-query-secret&access_token=provider-access-secret',
    );
    const apiContractEvidence =
      'ApiSuccessEnvelope and ApiErrorEnvelope declare stable ok/data and ok/error contracts with canonical error codes.';
    const virtualAssetEvidence = {
      path: 'assets://bgm/licensed-bgm.wav',
      nested: {
        sfx: 'assets://sfx/click.wav',
      },
    };
    const sanitizedContainsLeak =
      sanitized.includes('D:\\private\\workspace') ||
      sanitized.includes('Bearer report-secret-token') ||
      sanitized.includes('sk-live-report-safety-secret') ||
      sanitizedCredentialMessage.includes('b3BlcmF0b3I6c2VjcmV0') ||
      sanitizedCredentialMessage.includes('provider-header-secret') ||
      sanitizedCredentialMessage.includes('provider-query-secret') ||
      sanitizedCredentialMessage.includes('provider-access-secret');
    return checkResult({
      id: 'report-safety-helper',
      passed:
        reportContainsSensitiveData(unsafe) &&
        reportContainsSensitiveData({ tokenEcho: 'known-runtime-token' }, ['known-runtime-token']) &&
        unsafeCredentialShapes.every((shape) => reportContainsSensitiveData(shape)) &&
        !reportContainsSensitiveData(safeStatusEvidence) &&
        !reportContainsSensitiveData(redactedReport) &&
        !reportContainsSensitiveData(redactedKnownSecretReport, ['known-runtime-token']) &&
        !JSON.stringify(redactedKnownSecretReport).includes('known-runtime-token') &&
        redactedReport.nested.artifactPath === '<redacted-path>' &&
        redactedReport.nested.safeStatus.apiKeyConfigured === true &&
        redactedReport.nested.safeStatus.credentialStatus === 'configured' &&
        findLocalAbsolutePath(unsafe) === '$.error' &&
        findLocalAbsolutePath(apiContractEvidence) === '' &&
        findLocalAbsolutePath(virtualAssetEvidence) === '' &&
        !isLocalAbsolutePath('assets://bgm/licensed-bgm.wav') &&
        !sanitizedContainsLeak &&
        sanitized.includes('<redacted-path>') &&
        sanitized.includes('Bearer <redacted>') &&
        sanitized.includes('<redacted-secret>') &&
        sanitizedCredentialMessage.includes('Authorization: <redacted>') &&
        sanitizedCredentialMessage.includes('X-Api-Key: <redacted>') &&
        sanitizedCredentialMessage.includes('api_key=<redacted>') &&
        sanitizedCredentialMessage.includes('access_token=<redacted>'),
      evidence:
        'scripts/lib/report-safety.mjs centralizes credential-shaped value detection, known runtime secret detection, report redaction, embedded local path detection, safe status false-positive avoidance, API evidence false-positive avoidance, assets:// URI false-positive avoidance, and error-message redaction.',
      failMessage:
        'report-safety helper must detect common credential shapes, detect known runtime secrets, redact unsafe reports, detect embedded local paths, avoid safe status/API evidence/assets:// URI false positives, and redact unsafe error messages.',
    });
  } catch (error) {
    return checkResult({
      id: 'report-safety-helper',
      passed: false,
      evidence: '',
      failMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

async function checkBrowserChildProcessEnvSanitizer() {
  try {
    const { createBrowserChildProcessEnv } = await import('./lib/safe-env.mjs');
    const sanitized = createBrowserChildProcessEnv(
      {
        NODE_ENV: 'development',
        PATH: 'test-path',
        sdkwork_video_cut_server_token: 'lowercase-server-token',
        SDKWORK_VIDEO_CUT_HOST_URL: 'http://127.0.0.1:6177/api/video-cut/v1',
        SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_API_KEY: 'sk-node-cli-secret',
        SDKWORK_VIDEO_CUT_SERVER_TOKEN: 'server-token',
        SDKWORK_VIDEO_CUT_WORKSPACE_ROOT: './workspace',
        VIDEO_CUT_HOST_BIND: '127.0.0.1:6177',
        vite_video_cut_host_mode: 'http',
        VITE_VIDEO_CUT_HOST_BASE_URL: 'http://127.0.0.1:6177/api/video-cut/v1',
        VITE_VIDEO_CUT_SERVER_TOKEN: 'browser-leak-token',
      },
      {
        SDKWORK_VIDEO_CUT_PUBLIC_BASE_URL: 'http://127.0.0.1:6177',
        VITE_ALLOWED_BY_OVERRIDE: 'must-not-pass',
      },
    );
    const forbiddenKeys = Object.keys(sanitized).filter(
      (key) => {
        const normalizedKey = key.toUpperCase();
        return (
          normalizedKey.startsWith('VITE_') ||
          normalizedKey.startsWith('SDKWORK_VIDEO_CUT_') ||
          normalizedKey.startsWith('VIDEO_CUT_')
        );
      },
    );
    return checkResult({
      id: 'browser-child-process-env-sanitizer',
      passed:
        forbiddenKeys.length === 0 &&
        sanitized.NODE_ENV === 'development' &&
        sanitized.PATH === 'test-path',
      evidence: 'createBrowserChildProcessEnv strips VITE_*, SDKWORK_VIDEO_CUT_*, and legacy VIDEO_CUT_* before launching browser runtimes.',
      failMessage: `createBrowserChildProcessEnv leaked browser-forbidden environment keys: ${forbiddenKeys.join(', ')}`,
    });
  } catch (error) {
    return checkResult({
      id: 'browser-child-process-env-sanitizer',
      passed: false,
      evidence: '',
      failMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

async function checkCliModules() {
  const checks = [];
  for (const definition of CLI_MODULES) {
    try {
      const module = await import(definition.modulePath);
      const parser = module[definition.parser];
      if (typeof parser !== 'function') {
        checks.push(
          checkResult({
            id: `${definition.id}-parser-export`,
            passed: false,
            evidence: '',
            failMessage: `${definition.parser} is not exported.`,
          }),
        );
        continue;
      }

      const parsed = parser(definition.args, {});
      const expected = definition.expected ?? definition.expectedSubset;
      const matches = definition.expected ? deepEqual(parsed, expected) : objectContains(parsed, expected);
      checks.push(
        checkResult({
          id: `${definition.id}-separator-contract`,
          passed: matches,
          evidence: `${definition.parser} accepts pnpm -- separators.`,
          failMessage: `${definition.parser} parsed ${JSON.stringify(parsed)} instead of ${JSON.stringify(expected)}.`,
        }),
      );
    } catch (error) {
      checks.push(
        checkResult({
          id: `${definition.id}-separator-contract`,
          passed: false,
          evidence: '',
          failMessage: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return checks;
}

async function checkReportWriters(projectRoot) {
  const reportModules = [
    {
      modulePath: './check-video-cut-governance-suite.mjs',
      factory: 'createGovernanceReport',
      options: { category: 'license', projectRoot, reportDir: DEFAULT_REPORT_DIR },
      version: 'video-cut.governance-suite.v1',
    },
    {
      modulePath: './check-video-cut-deployment-artifacts.mjs',
      factory: 'createDeploymentArtifactsReport',
      options: { projectRoot, reportDir: DEFAULT_REPORT_DIR },
      version: 'video-cut.deployment-artifacts-report.v1',
    },
    {
      modulePath: './check-video-cut-openapi-contracts.mjs',
      factory: 'createOpenApiContractsReport',
      options: { projectRoot, reportDir: DEFAULT_REPORT_DIR },
      version: 'video-cut.openapi-contracts-report.v1',
    },
    {
      modulePath: './check-video-cut-deployment-matrix.mjs',
      factory: 'createDeploymentMatrixReport',
      options: { projectRoot, reportDir: DEFAULT_REPORT_DIR },
      version: 'video-cut.deployment-matrix.v1',
    },
    {
      modulePath: './check-video-cut-database-contracts.mjs',
      factory: 'createDatabaseContractsReport',
      options: { projectRoot, reportDir: DEFAULT_REPORT_DIR },
      version: 'video-cut.database-contracts-report.v1',
    },
    {
      modulePath: './check-video-cut-feature-readiness.mjs',
      factory: 'createFeatureReadinessReport',
      options: { projectRoot, reportDir: DEFAULT_REPORT_DIR },
      version: 'video-cut.feature-readiness-report.v1',
    },
    {
      modulePath: './check-video-cut-feature-readiness-policy.mjs',
      factory: 'createFeatureReadinessPolicyReport',
      options: { projectRoot, reportDir: DEFAULT_REPORT_DIR },
      version: 'video-cut.feature-readiness-policy-report.v1',
    },
    {
      modulePath: './check-video-cut-smoke-evidence-contracts.mjs',
      factory: 'createSmokeEvidenceContractsReport',
      options: { projectRoot, reportDir: DEFAULT_REPORT_DIR },
      version: 'video-cut.smoke-evidence-contracts-report.v1',
    },
    {
      modulePath: './release/run-release-matrix.mjs',
      factory: 'createReleaseMatrixReport',
      options: {
        projectRoot,
        releaseAssetsDir: 'artifacts/cli-contracts/release-matrix',
        reportDir: 'artifacts/cli-contracts/governance',
        releaseWithGovernanceImpl: createUnsafeFailingReleaseWithGovernanceImpl(),
      },
      version: 'video-cut.release-matrix-report.v1',
      expectedStatus: 'fail',
      requiredCheck: {
        id: 'release-matrix-redaction-and-path-safety',
        status: 'pass',
      },
      forbiddenFragments: ['D:\\private\\workspace', 'Bearer matrix-secret-token', 'sk-live-cli-contract-secret'],
    },
    {
      modulePath: './release/check-release-smoke-preflight.mjs',
      factory: 'createReleaseSmokePreflightReport',
      options: {
        projectRoot,
        releaseAssetsDir: 'artifacts/cli-contracts/release-smoke-matrix',
        reportDir: 'artifacts/cli-contracts/governance',
        smokeReportDir: 'artifacts/cli-contracts/release-smoke-matrix/smoke',
        probes: createPassingReleaseSmokePreflightProbes(),
      },
      version: 'video-cut.release-smoke-preflight-report.v1',
      requiredCheck: {
        id: 'release-smoke-preflight-redaction-and-path-safety',
        status: 'pass',
      },
      requiredArrayField: 'environmentBlockers',
      requiredObjectField: 'runnerConfig',
      requiredSecondArrayField: 'remediationActions',
      forbiddenFragments: ['D:\\private\\workspace', 'Bearer preflight-secret-token', 'sk-live-preflight-secret'],
    },
    {
      modulePath: './release/run-release-smoke-matrix.mjs',
      factory: 'createReleaseSmokeMatrixReport',
      options: {
        projectRoot,
        releaseAssetsDir: 'artifacts/cli-contracts/release-smoke-matrix',
        reportDir: 'artifacts/cli-contracts/governance',
        preflightImpl: createPassingReleaseSmokePreflightReportImpl(),
        smokeRunners: createUnsafeFailingSmokeRunners(),
      },
      version: 'video-cut.release-smoke-matrix-report.v1',
      expectedStatus: 'fail',
      requiredCheck: {
        id: 'release-smoke-matrix-redaction-and-path-safety',
        status: 'pass',
      },
      requiredArrayField: 'environmentBlockers',
      forbiddenFragments: ['D:\\private\\workspace', 'Bearer matrix-secret-token', 'sk-live-cli-contract-secret'],
    },
    {
      modulePath: './check-video-cut-release-smoke-readiness.mjs',
      factory: 'createReleaseSmokeReadinessReport',
      options: {
        projectRoot,
        reportDir: 'artifacts/cli-contracts/governance',
        preflightReportPath: 'artifacts/cli-contracts/release-smoke-preflight-report.json',
        matrixReportPath: 'artifacts/cli-contracts/release-smoke-matrix-report.json',
        readJsonImpl: createBlockedReleaseSmokeReadinessReadJsonImpl(),
      },
      version: 'video-cut.release-smoke-readiness-report.v1',
      expectedStatus: 'pass',
      requiredCheck: {
        id: 'release-smoke-readiness-redaction-and-path-safety',
        status: 'pass',
      },
      requiredArrayField: 'environmentBlockers',
      requiredObjectField: 'remediationSummary',
      requiredRemediationActionId: 'release-smoke-preflight-ffmpeg-spawn',
      requiredField: {
        name: 'promotionEligible',
        value: false,
      },
      forbiddenFragments: ['D:\\private\\workspace', 'Bearer smoke-readiness-secret-token', 'sk-live-smoke-readiness-secret'],
    },
    {
      modulePath: './check-video-cut-release-smoke-readiness.mjs',
      factory: 'createReleaseSmokeReadinessReport',
      options: {
        projectRoot,
        reportDir: 'artifacts/cli-contracts/governance/ready-required',
        preflightReportPath: 'artifacts/cli-contracts/release-smoke-preflight-report.json',
        matrixReportPath: 'artifacts/cli-contracts/release-smoke-matrix-report.json',
        requireReady: true,
        readJsonImpl: createBlockedReleaseSmokeReadinessReadJsonImpl(),
      },
      version: 'video-cut.release-smoke-readiness-report.v1',
      expectedStatus: 'fail',
      requiredCheck: {
        id: 'release-smoke-readiness-ready-required',
        status: 'fail',
      },
      requiredField: {
        name: 'requireReady',
        value: true,
      },
      requiredSecondField: {
        name: 'promotionEligible',
        value: false,
      },
      requiredArrayField: 'environmentBlockers',
      requiredObjectField: 'remediationSummary',
      requiredRemediationActionId: 'release-smoke-preflight-ffmpeg-spawn',
      forbiddenFragments: ['D:\\private\\workspace', 'Bearer smoke-readiness-secret-token', 'sk-live-smoke-readiness-secret'],
    },
    {
      modulePath: './release/run-release-smoke-ready.mjs',
      factory: 'createReleaseSmokeReadyReport',
      options: {
        projectRoot,
        releaseAssetsDir: 'artifacts/cli-contracts/release-smoke-ready',
        reportDir: 'artifacts/cli-contracts/governance/release-smoke-ready',
        smokeReportDir: 'artifacts/cli-contracts/release-smoke-ready/smoke',
        preflightImpl: createBlockedReleaseSmokeReadyPreflightImpl(),
        matrixImpl: createBlockedReleaseSmokeReadyMatrixImpl(),
        readinessImpl: createBlockedReleaseSmokeReadyReadinessImpl(),
      },
      version: 'video-cut.release-smoke-ready-report.v1',
      expectedStatus: 'fail',
      requiredChecks: [
        {
          id: 'release-smoke-ready-readiness-required',
          status: 'fail',
        },
        {
          id: 'release-smoke-ready-promotion-eligible',
          status: 'pass',
        },
      ],
      requiredField: {
        name: 'requireReady',
        value: true,
      },
      requiredSecondField: {
        name: 'promotionEligible',
        value: false,
      },
      requiredArrayField: 'environmentBlockers',
      requiredObjectField: 'remediationSummary',
      requiredRemediationActionId: 'release-smoke-preflight-ffmpeg-spawn',
      forbiddenFragments: ['D:\\private\\workspace', 'Bearer smoke-ready-secret-token', 'sk-live-smoke-ready-secret'],
    },
    {
      modulePath: './release/run-release-ready.mjs',
      factory: 'createReleaseReadyReport',
      options: {
        projectRoot,
        releaseAssetsDir: 'artifacts/cli-contracts/release-ready/packages',
        smokeReleaseAssetsDir: 'artifacts/cli-contracts/release-ready/smoke',
        reportDir: 'artifacts/cli-contracts/governance/release-ready',
        smokeReportDir: 'artifacts/cli-contracts/release-ready/smoke/reports',
        governanceImpl: createPassingReleaseReadyGovernanceImpl(),
        packageMatrixImpl: createPassingReleaseReadyPackageMatrixImpl(),
        smokeReadyImpl: createBlockedReleaseReadySmokeReadyImpl(),
      },
      version: 'video-cut.release-ready-report.v1',
      expectedStatus: 'fail',
      requiredChecks: [
        {
          id: 'release-ready-smoke-ready',
          status: 'fail',
        },
        {
          id: 'release-ready-promotion-eligible',
          status: 'pass',
        },
      ],
      requiredField: {
        name: 'smokeStatus',
        value: 'blocked',
      },
      requiredSecondField: {
        name: 'promotionEligible',
        value: false,
      },
      requiredArrayField: 'environmentBlockers',
      requiredObjectField: 'remediationSummary',
      requiredRemediationActionId: 'release-smoke-preflight-ffmpeg-spawn',
      forbiddenFragments: ['D:\\private\\workspace', 'Bearer release-ready-secret-token', 'sk-live-release-ready-secret'],
    },
    {
      modulePath: './release/run-release-ready.mjs',
      factory: 'createReleaseReadyReport',
      options: {
        projectRoot,
        releaseAssetsDir: 'artifacts/cli-contracts/release-ready-inconsistent-smoke/packages',
        smokeReleaseAssetsDir: 'artifacts/cli-contracts/release-ready-inconsistent-smoke/smoke',
        reportDir: 'artifacts/cli-contracts/governance/release-ready-inconsistent-smoke',
        smokeReportDir: 'artifacts/cli-contracts/release-ready-inconsistent-smoke/smoke/reports',
        governanceImpl: createPassingReleaseReadyGovernanceImpl(),
        packageMatrixImpl: createPassingReleaseReadyPackageMatrixImpl(),
        smokeReadyImpl: createInconsistentPromotionReleaseReadySmokeReadyImpl(),
      },
      version: 'video-cut.release-ready-report.v1',
      expectedStatus: 'fail',
      requiredChecks: [
        {
          id: 'release-ready-smoke-ready',
          status: 'fail',
        },
        {
          id: 'release-ready-promotion-eligible',
          status: 'pass',
        },
      ],
      requiredField: {
        name: 'smokeStatus',
        value: 'failed',
      },
      requiredSecondField: {
        name: 'promotionEligible',
        value: false,
      },
      forbiddenFragments: ['D:\\private\\workspace', 'Bearer release-ready-secret-token', 'sk-live-release-ready-secret'],
    },
  ];

  try {
    for (const definition of reportModules) {
      const module = await import(definition.modulePath);
      const report = await module[definition.factory](definition.options);
      const expectedStatus = definition.expectedStatus ?? 'pass';
      const requiredChecks = definition.requiredChecks ?? (definition.requiredCheck ? [definition.requiredCheck] : []);
      const missingRequiredCheck = requiredChecks.find((requiredCheck) => {
        const check = report.checks?.find((candidate) => candidate?.id === requiredCheck.id);
        return check?.status !== requiredCheck.status;
      });
      const requiredRemediationAction = definition.requiredRemediationActionId
        ? report.remediationSummary?.actions?.find((action) => action?.id === definition.requiredRemediationActionId)
        : undefined;
      const serializedReport = JSON.stringify(report);
      const leakedForbiddenFragment = definition.forbiddenFragments?.find((fragment) => serializedReport.includes(fragment));
      if (
        report.reportVersion !== definition.version ||
        report.status !== expectedStatus ||
        !report.reportPath ||
        !existsSync(resolve(projectRoot, report.reportPath)) ||
        Boolean(missingRequiredCheck) ||
        (definition.requiredField && report[definition.requiredField.name] !== definition.requiredField.value) ||
        (definition.requiredSecondField &&
          report[definition.requiredSecondField.name] !== definition.requiredSecondField.value) ||
        (definition.requiredArrayField && !Array.isArray(report[definition.requiredArrayField])) ||
        (definition.requiredSecondArrayField && !Array.isArray(report[definition.requiredSecondArrayField])) ||
        (definition.requiredObjectField &&
          (!report[definition.requiredObjectField] || typeof report[definition.requiredObjectField] !== 'object')) ||
        (definition.requiredRemediationActionId &&
          (report.remediationSummary?.total < 1 ||
            !Array.isArray(report.remediationSummary?.actions) ||
            !requiredRemediationAction?.envVar ||
            !requiredRemediationAction?.commandHint ||
            !requiredRemediationAction?.action)) ||
        leakedForbiddenFragment
      ) {
        return checkResult({
          id: 'node-cli-report-writers',
          passed: false,
          evidence: '',
          failMessage: `${definition.factory} did not write the expected report contract.`,
        });
      }
    }
    return checkResult({
      id: 'node-cli-report-writers',
      passed: true,
      evidence:
        'Governance, deployment artifacts, OpenAPI contracts, deployment matrix, database contracts, feature readiness, feature readiness policy, smoke evidence, release matrix, release smoke matrix, release smoke readiness, release smoke ready, and release ready reports write standard JSON evidence with path-safe failure redaction and commercial ready-required gating.',
      failMessage: '',
    });
  } catch (error) {
    return checkResult({
      id: 'node-cli-report-writers',
      passed: false,
      evidence: '',
      failMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

function createUnsafeFailingReleaseWithGovernanceImpl() {
  return async () => {
    throw new Error('Unsafe release failure at D:\\private\\workspace with Bearer matrix-secret-token and sk-live-cli-contract-secret.');
  };
}

function createUnsafeFailingSmokeRunners() {
  const runner = async () => {
    throw new Error('Unsafe smoke failure at D:\\private\\workspace with Bearer matrix-secret-token and sk-live-cli-contract-secret.');
  };
  return {
    'http-workflow': runner,
    'managed-server': runner,
    'managed-ui': runner,
  };
}

function createPassingReleaseSmokePreflightProbes() {
  return {
    command: async ({ command }) => ({
      ok: true,
      evidence: `${command} spawn available.`,
      version: `${command} version`,
    }),
    browser: async () => ({
      ok: true,
      evidence: 'Chromium-compatible browser executable is configured.',
      source: 'configured',
    }),
    localPorts: async ({ count }) => ({
      ok: true,
      evidence: `${count} local ports are allocatable.`,
      count,
    }),
    writableDirectory: async ({ path }) => ({
      ok: true,
      evidence: `${path} is writable.`,
    }),
  };
}

function createPassingReleaseSmokePreflightReportImpl() {
  return async ({ reportDir = 'artifacts/governance' } = {}) => ({
    reportVersion: 'video-cut.release-smoke-preflight-report.v1',
    command: 'release:smoke:preflight',
    status: 'pass',
    environmentStatus: 'ready',
    environmentBlockers: [],
    reportPath: `${reportDir}/release-smoke-preflight-report.json`,
    summary: { pass: 8, warn: 0, fail: 0 },
    checks: [
      {
        id: 'release-smoke-preflight-redaction-and-path-safety',
        status: 'pass',
        evidence: 'Release smoke preflight report contains no credential-shaped values and no server-local absolute paths.',
      },
    ],
  });
}

function createBlockedReleaseSmokeReadinessReadJsonImpl() {
  const blocker = {
    id: 'release-smoke-preflight-ffmpeg-spawn',
    code: 'RELEASE_SMOKE_ENV_TOOL_SPAWN_BLOCKED',
    category: 'tool-spawn',
    evidence: 'FFmpeg command can be spawned for fixture generation and render smoke. spawnSync ffmpeg EPERM',
  };
  const blockers = [blocker];
  return (path) => {
    if (path.endsWith('release-smoke-preflight-report.json')) {
      return {
        reportVersion: 'video-cut.release-smoke-preflight-report.v1',
        command: 'release:smoke:preflight',
        status: 'fail',
        environmentStatus: 'blocked',
        environmentBlockers: blockers,
        reportPath: path,
        summary: { pass: 6, warn: 0, fail: 1 },
        checks: [
          {
            id: 'release-smoke-preflight-ffmpeg-spawn',
            status: 'fail',
            evidence: 'FFmpeg command can be spawned for fixture generation and render smoke. spawnSync ffmpeg EPERM',
          },
        ],
      };
    }

    return {
      reportVersion: 'video-cut.release-smoke-matrix-report.v1',
      command: 'release:smoke:matrix',
      status: 'fail',
      environmentStatus: 'blocked',
      environmentBlockers: blockers,
      reportPath: path,
      targetSummary: { total: 5, pass: 0, warn: 0, fail: 5, blocked: 5 },
      summary: { pass: 4, warn: 0, fail: 6 },
      checks: [],
      targets: ['desktop', 'server', 'web', 'container', 'kubernetes'].map((target) => ({
        target,
        status: 'blocked',
        environmentBlockers: blockers,
        smoke: {
          error: {
            code: 'RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED',
            message: 'Release smoke preflight failed; target smoke was skipped before mutating runtime state.',
          },
        },
      })),
    };
  };
}

function createSmokeReadyBlockers() {
  return [
    {
      id: 'release-smoke-preflight-ffmpeg-spawn',
      code: 'RELEASE_SMOKE_ENV_TOOL_SPAWN_BLOCKED',
      category: 'tool-spawn',
      evidence:
        'FFmpeg command can be spawned for fixture generation and render smoke. Unsafe path D:\\private\\workspace with Bearer smoke-ready-secret-token and sk-live-smoke-ready-secret.',
    },
  ];
}

function createSmokeReadyRemediationActions() {
  return [
    {
      id: 'release-smoke-preflight-ffmpeg-spawn',
      code: 'RELEASE_SMOKE_ENV_TOOL_SPAWN_BLOCKED',
      category: 'tool-spawn',
      envVar: 'SDKWORK_VIDEO_CUT_FFMPEG_PATH',
      commandHint: 'pnpm release:smoke:preflight -- --ffmpeg-path <project-relative-or-PATH-command> --json',
      action:
        'Install FFmpeg on the release runner or pass a CI-accessible command/path through --ffmpeg-path or SDKWORK_VIDEO_CUT_FFMPEG_PATH.',
    },
  ];
}

function createBlockedReleaseSmokeReadyPreflightImpl() {
  return async ({ reportDir = 'artifacts/governance' } = {}) => ({
    reportVersion: 'video-cut.release-smoke-preflight-report.v1',
    command: 'release:smoke:preflight',
    status: 'fail',
    environmentStatus: 'blocked',
    environmentBlockers: createSmokeReadyBlockers(),
    remediationActions: createSmokeReadyRemediationActions(),
    reportPath: `${reportDir}/release-smoke-preflight-report.json`,
    summary: { pass: 6, warn: 0, fail: 1 },
    checks: [
      {
        id: 'release-smoke-preflight-ffmpeg-spawn',
        status: 'fail',
        evidence:
          'FFmpeg command can be spawned for fixture generation and render smoke. Unsafe path D:\\private\\workspace with Bearer smoke-ready-secret-token and sk-live-smoke-ready-secret.',
      },
    ],
  });
}

function createBlockedReleaseSmokeReadyMatrixImpl() {
  return async ({ reportDir = 'artifacts/governance' } = {}) => {
    const blockers = createSmokeReadyBlockers();
    return {
      reportVersion: 'video-cut.release-smoke-matrix-report.v1',
      command: 'release:smoke:matrix',
      status: 'fail',
      environmentStatus: 'blocked',
      environmentBlockers: blockers,
      remediationActions: createSmokeReadyRemediationActions(),
      reportPath: `${reportDir}/release-smoke-matrix-report.json`,
      targetSummary: { total: 5, pass: 0, warn: 0, fail: 5, blocked: 5 },
      summary: { pass: 4, warn: 0, fail: 6 },
      checks: [
        {
          id: 'release-smoke-matrix-redaction-and-path-safety',
          status: 'pass',
          evidence: 'Release smoke matrix report contains no credential-shaped values and no server-local absolute paths.',
        },
      ],
      targets: ['desktop', 'server', 'web', 'container', 'kubernetes'].map((target) => ({
        target,
        status: 'blocked',
        environmentBlockers: blockers,
        smoke: {
          error: {
            code: 'RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED',
            message: 'Release smoke preflight failed; target smoke was skipped before mutating runtime state.',
          },
        },
      })),
    };
  };
}

function createBlockedReleaseSmokeReadyReadinessImpl() {
  return ({ reportDir = 'artifacts/governance', requireReady }) => ({
    reportVersion: 'video-cut.release-smoke-readiness-report.v1',
    command: 'check:release-smoke-readiness',
    status: 'fail',
    requireReady: requireReady === true,
    readinessStatus: 'blocked',
    promotionEligible: false,
    environmentStatus: 'blocked',
    environmentBlockers: createSmokeReadyBlockers(),
    remediationActions: createSmokeReadyRemediationActions(),
    reportPath: `${reportDir}/release-smoke-readiness-report.json`,
    summary: { pass: 6, warn: 0, fail: 1 },
    checks: [
      {
        id: 'release-smoke-readiness-ready-required',
        status: 'fail',
        evidence: 'Commercial release readiness requires readinessStatus=ready; current readinessStatus=blocked.',
      },
      {
        id: 'release-smoke-readiness-promotion-eligible',
        status: 'pass',
        evidence: 'Release smoke readiness is not promotion eligible because readinessStatus=blocked.',
      },
    ],
  });
}

function createPassingReleaseReadyGovernanceImpl() {
  return ({ reportDir = 'artifacts/governance' } = {}) => ({
    reportVersion: 'video-cut.governance-suite.v1',
    command: 'check:governance',
    category: 'all',
    status: 'pass',
    reportPath: `${reportDir}/governance-suite-report.json`,
    summary: { pass: 60, warn: 0, fail: 0 },
    checks: [],
  });
}

function createPassingReleaseReadyPackageMatrixImpl() {
  return async ({ releaseAssetsDir = 'artifacts/release-matrix', reportDir = 'artifacts/governance' } = {}) => ({
    reportVersion: 'video-cut.release-matrix-report.v1',
    command: 'release:package:matrix',
    status: 'pass',
    releaseAssetsDir,
    reportPath: `${reportDir}/release-matrix-report.json`,
    targetSummary: { total: 5, pass: 5, warn: 0, fail: 0 },
    summary: { pass: 8, warn: 0, fail: 0 },
    checks: [
      {
        id: 'release-matrix-redaction-and-path-safety',
        status: 'pass',
        evidence: 'Release matrix report contains no credential-shaped values and no server-local absolute paths.',
      },
    ],
    targets: ['desktop', 'server', 'web', 'container', 'kubernetes'].map((target) => ({
      target,
      action: 'package',
      status: 'pass',
      releaseAssetsDir: `${releaseAssetsDir}/${target}`,
      releaseReport: { status: 'pass', summary: { pass: 1, warn: 0, fail: 0 } },
      releaseContracts: { status: 'pass', summary: { pass: 1, warn: 0, fail: 0 } },
      signatureVerification: { status: 'pass', summary: { pass: 1, warn: 0, fail: 0 } },
    })),
  });
}

function createBlockedReleaseReadySmokeReadyImpl() {
  return async ({ reportDir = 'artifacts/governance' } = {}) => ({
    reportVersion: 'video-cut.release-smoke-ready-report.v1',
    command: 'release:smoke:ready',
    status: 'fail',
    requireReady: true,
    readinessStatus: 'blocked',
    promotionEligible: false,
    environmentStatus: 'blocked',
    environmentBlockers: [
      {
        id: 'release-smoke-preflight-ffmpeg-spawn',
        code: 'RELEASE_SMOKE_ENV_TOOL_SPAWN_BLOCKED',
        category: 'tool-spawn',
        evidence:
          'FFmpeg command can be spawned for fixture generation and render smoke. Unsafe path D:\\private\\workspace with Bearer release-ready-secret-token and sk-live-release-ready-secret.',
      },
    ],
    remediationSummary: {
      total: 1,
      actions: [
        {
          id: 'release-smoke-preflight-ffmpeg-spawn',
          code: 'RELEASE_SMOKE_ENV_TOOL_SPAWN_BLOCKED',
          category: 'tool-spawn',
          envVar: 'SDKWORK_VIDEO_CUT_FFMPEG_PATH',
          commandHint: 'pnpm release:smoke:preflight -- --ffmpeg-path <project-relative-or-PATH-command> --json',
          action:
            'Install FFmpeg on the release runner or pass a CI-accessible command/path through --ffmpeg-path or SDKWORK_VIDEO_CUT_FFMPEG_PATH.',
        },
      ],
    },
    reportPath: `${reportDir}/release-smoke-ready-report.json`,
    summary: { pass: 3, warn: 0, fail: 1 },
    checks: [
      {
        id: 'release-smoke-ready-readiness-required',
        status: 'fail',
        evidence: 'Commercial release smoke ready gate requires readinessStatus=ready; current readinessStatus=blocked.',
      },
      {
        id: 'release-smoke-ready-promotion-eligible',
        status: 'pass',
        evidence: 'Release smoke ready report is not promotion eligible because readinessStatus=blocked.',
      },
    ],
  });
}

function createInconsistentPromotionReleaseReadySmokeReadyImpl() {
  return async ({ reportDir = 'artifacts/governance' } = {}) => ({
    reportVersion: 'video-cut.release-smoke-ready-report.v1',
    command: 'release:smoke:ready',
    status: 'pass',
    requireReady: true,
    readinessStatus: 'ready',
    promotionEligible: false,
    environmentStatus: 'ready',
    environmentBlockers: [],
    remediationSummary: {
      total: 0,
      actions: [],
    },
    reportPath: `${reportDir}/release-smoke-ready-report.json`,
    summary: { pass: 4, warn: 0, fail: 0 },
    checks: [
      {
        id: 'release-smoke-ready-readiness-required',
        status: 'pass',
        evidence: 'Commercial release smoke ready gate has readinessStatus=ready.',
      },
      {
        id: 'release-smoke-ready-promotion-eligible',
        status: 'fail',
        evidence:
          'Release smoke ready report promotion eligibility is internally inconsistent and must not be promoted.',
      },
    ],
  });
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

function objectContains(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual?.[key] === value);
}

function readJson(projectRoot, path) {
  return JSON.parse(readFileSync(resolve(projectRoot, path), 'utf8'));
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
