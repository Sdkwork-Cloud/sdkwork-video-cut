#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import YAML from 'yaml';

import { createReportPath } from './lib/report-paths.mjs';
import { normalizeCliArgs } from './lib/cli-args.mjs';

const REPORT_VERSION = 'video-cut.deployment-matrix.v1';
const COMMAND = 'check:deployment-matrix';
const CANONICAL_API_ROUTE = '/api/video-cut/v1';

const REQUIRED_PACKAGE_SCRIPTS = {
  'check:cli-contracts': 'node scripts/check-video-cut-cli-contracts.mjs',
  'check:contracts': 'vitest --run src/__tests__/openApiContract.test.ts',
  'check:deployment-artifacts': 'node scripts/check-video-cut-deployment-artifacts.mjs',
  'check:deployment-matrix': 'node scripts/check-video-cut-deployment-matrix.mjs',
  'check:release-contracts': 'node scripts/check-video-cut-release-contracts.mjs',
  'verify:release-signature': 'node scripts/verify-video-cut-release-signature.mjs',
  'tauri:dev': 'node scripts/run-video-cut-tauri-dev.mjs',
  'tauri:before-dev': 'node scripts/run-video-cut-tauri-dev-stack.mjs',
  'deployment:doctor': 'node scripts/run-video-cut-deployment-doctor.mjs desktop-dev --deployment-mode desktop-local',
  'deployment:doctor:desktop:local':
    'node scripts/run-video-cut-deployment-doctor.mjs desktop-dev --deployment-mode desktop-local',
  'deployment:doctor:server:private':
    'node scripts/run-video-cut-deployment-doctor.mjs server-dev --deployment-mode server-private',
  'workflow:smoke': 'node scripts/run-video-cut-http-workflow-smoke.mjs desktop-dev --deployment-mode desktop-local',
  'workflow:smoke:desktop:local':
    'node scripts/run-video-cut-http-workflow-smoke.mjs desktop-dev --deployment-mode desktop-local',
  'workflow:smoke:server:private':
    'node scripts/run-video-cut-http-workflow-smoke.mjs server-dev --deployment-mode server-private',
  'workflow:smoke:server:managed':
    'node scripts/run-video-cut-managed-server-smoke.mjs server-dev --deployment-mode server-private',
  'workflow:smoke:server:private:managed':
    'node scripts/run-video-cut-managed-server-smoke.mjs server-dev --deployment-mode server-private',
  'workflow:smoke:ui:managed':
    'node scripts/run-video-cut-managed-ui-smoke.mjs server-dev --deployment-mode server-private',
  'workflow:smoke:server:ui:managed':
    'node scripts/run-video-cut-managed-ui-smoke.mjs server-dev --deployment-mode server-private',
  'release:package:desktop': 'node scripts/release/run-release-with-governance.mjs package desktop',
  'release:package:container': 'node scripts/release/run-release-with-governance.mjs package container',
  'release:package:kubernetes': 'node scripts/release/run-release-with-governance.mjs package kubernetes',
  'release:package:matrix': 'node scripts/release/run-release-matrix.mjs',
  'release:smoke:preflight': 'node scripts/release/check-release-smoke-preflight.mjs',
  'release:smoke:matrix': 'node scripts/release/run-release-smoke-matrix.mjs',
  'release:package:server': 'node scripts/release/run-release-with-governance.mjs package server',
  'release:package:web': 'node scripts/release/run-release-with-governance.mjs package web',
  'release:smoke:desktop':
    'node scripts/run-video-cut-http-workflow-smoke.mjs desktop-dev --deployment-mode desktop-local --report-path artifacts/release/smoke/desktop-smoke-report.json && node scripts/release/run-release-with-governance.mjs smoke desktop --smoke-report artifacts/release/smoke/desktop-smoke-report.json --release-assets-dir artifacts/release',
  'release:smoke:container':
    'node scripts/run-video-cut-http-workflow-smoke.mjs container-release --deployment-mode container-private --report-path artifacts/release/smoke/container-smoke-report.json && node scripts/release/run-release-with-governance.mjs smoke container --smoke-report artifacts/release/smoke/container-smoke-report.json --release-assets-dir artifacts/release',
  'release:smoke:kubernetes':
    'node scripts/run-video-cut-http-workflow-smoke.mjs kubernetes-release --deployment-mode kubernetes-private --report-path artifacts/release/smoke/kubernetes-smoke-report.json && node scripts/release/run-release-with-governance.mjs smoke kubernetes --smoke-report artifacts/release/smoke/kubernetes-smoke-report.json --release-assets-dir artifacts/release',
  'release:smoke:server':
    'node scripts/run-video-cut-managed-server-smoke.mjs server-dev --deployment-mode server-private --report-path artifacts/release/smoke/server-smoke-report.json && node scripts/release/run-release-with-governance.mjs smoke server --smoke-report artifacts/release/smoke/server-smoke-report.json --release-assets-dir artifacts/release',
  'release:smoke:web':
    'node scripts/run-video-cut-managed-ui-smoke.mjs server-dev --deployment-mode server-private --report-path artifacts/release/smoke/web-smoke-report.json && node scripts/release/run-release-with-governance.mjs smoke web --smoke-report artifacts/release/smoke/web-smoke-report.json --release-assets-dir artifacts/release',
};

const REQUIRED_FILES = {
  desktop: [
    'src-tauri/Cargo.toml',
    'src-tauri/build.rs',
    'src-tauri/icons/icon.ico',
    'src-tauri/tauri.conf.json',
    'src-tauri/src/main.rs',
    'scripts/run-video-cut-tauri-dev.mjs',
    'scripts/run-video-cut-tauri-dev-stack.mjs',
  ],
  docker: ['deploy/docker/Dockerfile', 'deploy/docker/docker-compose.yml', 'deploy/docker/nginx.conf'],
  kubernetes: [
    'deploy/kubernetes/Chart.yaml',
    'deploy/kubernetes/values.yaml',
    'deploy/kubernetes/templates/configmap.yaml',
    'deploy/kubernetes/templates/deployment.yaml',
    'deploy/kubernetes/templates/hpa.yaml',
    'deploy/kubernetes/templates/ingress.yaml',
    'deploy/kubernetes/templates/pvc.yaml',
    'deploy/kubernetes/templates/secret.yaml',
    'deploy/kubernetes/templates/service.yaml',
  ],
  release: [
    'scripts/release/local-release-command.mjs',
    'scripts/release/run-release-with-governance.mjs',
    'scripts/release/run-release-matrix.mjs',
    'scripts/release/check-release-smoke-preflight.mjs',
    'scripts/release/run-release-smoke-matrix.mjs',
    'scripts/check-video-cut-release-contracts.mjs',
    'scripts/verify-video-cut-release-signature.mjs',
  ],
};

export function parseMatrixArgs(argv) {
  const args = normalizeCliArgs(argv);
  let json = false;
  let reportDir = 'artifacts/governance';

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

    throw new Error(`Unknown deployment matrix argument: ${arg}`);
  }

  return { json, reportDir };
}

export function createDeploymentMatrixReport({ projectRoot = process.cwd(), reportDir = 'artifacts/governance' } = {}) {
  const packageJson = readJson(resolve(projectRoot, 'package.json'));
  const checks = [
    checkCanonicalApiRoute(projectRoot),
    checkTauriDesktopShell(projectRoot, packageJson),
    checkDoctorScripts(packageJson),
    checkHttpWorkflowSmokeScripts(projectRoot, packageJson),
    checkManagedServerSmokeScripts(projectRoot, packageJson),
    checkManagedUiSmokeScripts(projectRoot, packageJson),
    checkCliContractsScript(projectRoot, packageJson),
    checkReleaseScripts(packageJson),
    checkRuntimeProfileManifest(projectRoot),
    checkFiles(projectRoot, 'docker-artifacts', REQUIRED_FILES.docker),
    checkDockerPrivateHostExposure(projectRoot),
    checkFiles(projectRoot, 'kubernetes-artifacts', REQUIRED_FILES.kubernetes),
    checkKubernetesPrivateHostService(projectRoot),
    checkEnvExampleStandardPrefix(projectRoot),
    checkFiles(projectRoot, 'release-command-artifacts', REQUIRED_FILES.release),
  ];
  const summary = summarizeChecks(checks);

  const { absolutePath: absoluteReportPath, reportPath } = createReportPath(
    projectRoot,
    reportDir,
    'deployment-matrix-report.json',
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
  writeReport(absoluteReportPath, report);
  return report;
}

function checkRuntimeProfileManifest(projectRoot) {
  const manifestPath = 'deploy/runtime-profiles.yaml';
  const manifestText = readText(projectRoot, manifestPath);
  const manifest = manifestText ? YAML.parse(manifestText) : {};
  const profiles = Array.isArray(manifest?.profiles) ? manifest.profiles : [];
  const byMode = new Map(profiles.map((profile) => [profile.deploymentMode, profile]));
  const requiredModes = ['desktop-local', 'server-private', 'web-private', 'container-private', 'kubernetes-private'];
  const missingModes = requiredModes.filter((mode) => !byMode.has(mode));
  const invalidProfiles = profiles.filter((profile) => {
    return (
      !profile.profileId ||
      !profile.deploymentMode ||
      !profile.readinessLevel ||
      profile.apiContract !== CANONICAL_API_ROUTE ||
      !Array.isArray(profile.requiredChecks) ||
      !profile.requiredChecks.includes('health') ||
      !profile.requiredChecks.includes('capability') ||
      profile.readinessLevel === 'scale-ready'
    );
  });
  const containerProfile = byMode.get('container-private');
  const kubernetesProfile = byMode.get('kubernetes-private');
  const dockerCompose = readText(projectRoot, 'deploy/docker/docker-compose.yml');
  const values = readText(projectRoot, 'deploy/kubernetes/values.yaml');
  const modeDrift = [];
  if (containerProfile && !dockerCompose.includes(`SDKWORK_VIDEO_CUT_RUNTIME_MODE: ${containerProfile.deploymentMode}`)) {
    modeDrift.push('container-private');
  }
  if (kubernetesProfile && !values.includes(`deploymentMode: ${kubernetesProfile.deploymentMode}`)) {
    modeDrift.push('kubernetes-private');
  }

  return checkResult({
    id: 'runtime-profile-manifest',
    evidence: `${manifestPath}; modes=${requiredModes.join(', ')}`,
    failMessage: `Runtime profile manifest drift. Missing modes: ${missingModes.join(', ')} invalid profiles: ${invalidProfiles
      .map((profile) => profile.deploymentMode)
      .join(', ')} mode drift: ${modeDrift.join(', ')}`,
    passed:
      manifest.registryVersion === 'video-cut.runtime-profile-registry.v1' &&
      missingModes.length === 0 &&
      invalidProfiles.length === 0 &&
      modeDrift.length === 0,
  });
}

function checkTauriDesktopShell(projectRoot, packageJson) {
  const files = REQUIRED_FILES.desktop;
  const missing = files.filter((file) => !existsSync(resolve(projectRoot, file)));
  const configText = readText(projectRoot, 'src-tauri/tauri.conf.json');
  const mainText = readText(projectRoot, 'src-tauri/src/main.rs');
  const devStackText = readText(projectRoot, 'scripts/run-video-cut-tauri-dev-stack.mjs');
  const missingScripts = ['tauri:dev', 'tauri:before-dev'].filter(
    (name) => packageJson.scripts?.[name] !== REQUIRED_PACKAGE_SCRIPTS[name],
  );
  const passed =
    missing.length === 0 &&
    missingScripts.length === 0 &&
    Boolean(packageJson.devDependencies?.['@tauri-apps/cli']) &&
    configText.includes('"beforeDevCommand": "pnpm tauri:before-dev"') &&
    configText.includes('"devUrl": "http://127.0.0.1:5173"') &&
    mainText.includes('tauri::Builder::default()') &&
    !mainText.includes('ffmpeg') &&
    !mainText.includes('/api/video-cut/v1') &&
    devStackText.includes('SDKWORK_VIDEO_CUT_RUNTIME_MODE') &&
    !devStackText.includes('VITE_VIDEO_CUT_HOST_MODE') &&
    !devStackText.includes('VITE_VIDEO_CUT_HOST_BASE_URL') &&
    devStackText.includes('http://127.0.0.1:6177/api/video-cut/v1');

  return checkResult({
    id: 'tauri-desktop-shell',
    evidence: `${files.join(', ')}; tauri:dev`,
    failMessage: `Tauri desktop shell drift. Missing files: ${missing.join(', ')} missing scripts: ${missingScripts.join(', ')}`,
    passed,
  });
}

function checkCanonicalApiRoute(projectRoot) {
  const files = ['docs/openapi/video-cut-v1.yaml', 'src/services/createVideoCutHostClient.ts', 'deploy/docker/nginx.conf'];
  const missing = files.filter((file) => !readText(projectRoot, file).includes(CANONICAL_API_ROUTE));

  return checkResult({
    id: 'canonical-api-route',
    evidence: CANONICAL_API_ROUTE,
    failMessage: `Canonical API route missing from: ${missing.join(', ')}`,
    passed: missing.length === 0,
  });
}

function checkDoctorScripts(packageJson) {
  const expectedScriptNames = ['deployment:doctor', 'deployment:doctor:desktop:local', 'deployment:doctor:server:private'];
  const missing = expectedScriptNames.filter((name) => packageJson.scripts?.[name] !== REQUIRED_PACKAGE_SCRIPTS[name]);

  return checkResult({
    id: 'doctor-script-matrix',
    evidence: expectedScriptNames.join(', '),
    failMessage: `Doctor scripts missing or drifted: ${missing.join(', ')}`,
    passed: missing.length === 0,
  });
}

function checkHttpWorkflowSmokeScripts(projectRoot, packageJson) {
  const expectedScriptNames = ['workflow:smoke', 'workflow:smoke:desktop:local', 'workflow:smoke:server:private'];
  const missing = expectedScriptNames.filter((name) => packageJson.scripts?.[name] !== REQUIRED_PACKAGE_SCRIPTS[name]);
  const scriptPath = 'scripts/run-video-cut-http-workflow-smoke.mjs';
  const cliContractsScript = 'scripts/check-video-cut-cli-contracts.mjs';
  const scriptExists = existsSync(resolve(projectRoot, scriptPath));
  const cliContractsScriptExists = existsSync(resolve(projectRoot, cliContractsScript));

  return checkResult({
    id: 'http-workflow-smoke-script-matrix',
    evidence: `${expectedScriptNames.join(', ')}; ${scriptPath}; ${cliContractsScript}`,
    failMessage: `HTTP workflow smoke scripts missing or drifted: ${[
      ...missing,
      ...(scriptExists ? [] : [scriptPath]),
      ...(cliContractsScriptExists ? [] : [cliContractsScript]),
    ].join(', ')}`,
    passed: missing.length === 0 && scriptExists && cliContractsScriptExists,
  });
}

function checkManagedServerSmokeScripts(projectRoot, packageJson) {
  const expectedScriptNames = ['workflow:smoke:server:managed', 'workflow:smoke:server:private:managed'];
  const missing = expectedScriptNames.filter((name) => packageJson.scripts?.[name] !== REQUIRED_PACKAGE_SCRIPTS[name]);
  const scriptPath = 'scripts/run-video-cut-managed-server-smoke.mjs';
  const scriptExists = existsSync(resolve(projectRoot, scriptPath));

  return checkResult({
    id: 'managed-server-smoke-script-matrix',
    evidence: `${expectedScriptNames.join(', ')}; ${scriptPath}`,
    failMessage: `Managed server smoke scripts missing or drifted: ${[...missing, ...(scriptExists ? [] : [scriptPath])].join(', ')}`,
    passed: missing.length === 0 && scriptExists,
  });
}

function checkManagedUiSmokeScripts(projectRoot, packageJson) {
  const expectedScriptNames = ['workflow:smoke:ui:managed', 'workflow:smoke:server:ui:managed'];
  const missing = expectedScriptNames.filter((name) => packageJson.scripts?.[name] !== REQUIRED_PACKAGE_SCRIPTS[name]);
  const scriptPath = 'scripts/run-video-cut-managed-ui-smoke.mjs';
  const scriptExists = existsSync(resolve(projectRoot, scriptPath));

  return checkResult({
    id: 'managed-ui-smoke-script-matrix',
    evidence: `${expectedScriptNames.join(', ')}; ${scriptPath}; playwright-core`,
    failMessage: `Managed UI smoke scripts missing or drifted: ${[...missing, ...(scriptExists ? [] : [scriptPath])].join(', ')}`,
    passed: missing.length === 0 && scriptExists && Boolean(packageJson.devDependencies?.['playwright-core']),
  });
}

function checkCliContractsScript(projectRoot, packageJson) {
  const scriptPath = 'scripts/check-video-cut-cli-contracts.mjs';
  const passed =
    packageJson.scripts?.['check:cli-contracts'] === REQUIRED_PACKAGE_SCRIPTS['check:cli-contracts'] &&
    existsSync(resolve(projectRoot, scriptPath));

  return checkResult({
    id: 'cli-contracts-script',
    evidence: `check:cli-contracts; ${scriptPath}`,
    failMessage: 'check:cli-contracts must point to the pure Node CLI contract checker.',
    passed,
  });
}

function checkReleaseScripts(packageJson) {
  const names = Object.keys(REQUIRED_PACKAGE_SCRIPTS).filter(
    (name) => name.startsWith('release:') || name === 'check:release-contracts' || name === 'verify:release-signature',
  );
  const missing = names.filter((name) => packageJson.scripts?.[name] !== REQUIRED_PACKAGE_SCRIPTS[name]);

  return checkResult({
    id: 'release-script-matrix',
    evidence: names.join(', '),
    failMessage: `Release scripts missing or drifted: ${missing.join(', ')}`,
    passed: missing.length === 0,
  });
}

function checkFiles(projectRoot, id, files) {
  const missing = files.filter((file) => !existsSync(resolve(projectRoot, file)));

  return checkResult({
    id,
    evidence: files.join(', '),
    failMessage: `Deployment files missing: ${missing.join(', ')}`,
    passed: missing.length === 0,
  });
}

function checkDockerPrivateHostExposure(projectRoot) {
  const composeText = readText(projectRoot, 'deploy/docker/docker-compose.yml');
  const compose = YAML.parse(composeText);
  const hostService = compose?.services?.['video-cut-host'] ?? {};
  const authMode = hostService?.environment?.SDKWORK_VIDEO_CUT_AUTH_MODE;
  const ports = Array.isArray(hostService?.ports) ? hostService.ports : [];
  const expose = Array.isArray(hostService?.expose) ? hostService.expose.map(String) : [];
  const passed = authMode === 'reverse-proxy' && ports.length === 0 && expose.includes('6177');

  return checkResult({
    id: 'docker-private-host-exposure',
    evidence: 'video-cut-host uses expose=6177 and no host ports in reverse-proxy mode',
    failMessage: 'Docker Compose reverse-proxy mode must not publish video-cut-host ports directly.',
    passed,
  });
}

function checkKubernetesPrivateHostService(projectRoot) {
  const valuesText = readText(projectRoot, 'deploy/kubernetes/values.yaml');
  const serviceText = readText(projectRoot, 'deploy/kubernetes/templates/service.yaml');
  const passed =
    valuesText.includes('authMode: reverse-proxy') &&
    !valuesText.includes('hostPort:') &&
    serviceText.includes('name: http') &&
    !serviceText.includes('name: host') &&
    !serviceText.includes('targetPort: host');

  return checkResult({
    id: 'kubernetes-private-host-service',
    evidence: 'Kubernetes Service exposes only the web/http proxy port',
    failMessage: 'Kubernetes reverse-proxy mode must not publish the Host container as a Service port.',
    passed,
  });
}

function checkEnvExampleStandardPrefix(projectRoot) {
  const envText = readText(projectRoot, '.env.example');
  const legacyLinePattern = /^VIDEO_CUT_(HOST_BIND|WORKSPACE_ROOT)=/m;
  const passed =
    envText.includes('SDKWORK_VIDEO_CUT_RUNTIME_MODE=desktop-local') &&
    envText.includes('SDKWORK_VIDEO_CUT_WORKSPACE_ROOT=./workspace') &&
    !legacyLinePattern.test(envText);

  return checkResult({
    id: 'env-example-standard-prefix',
    evidence: '.env.example uses SDKWORK_VIDEO_CUT_* runtime variables',
    failMessage: '.env.example must use SDKWORK_VIDEO_CUT_* and must not define legacy VIDEO_CUT_* variables.',
    passed,
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readText(projectRoot, path) {
  const absolutePath = resolve(projectRoot, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printHumanReport(report) {
  const lines = [
    `SDKWork Video Cut Deployment Matrix`,
    `status: ${report.status}`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
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
    const options = parseMatrixArgs(process.argv.slice(2));
    const report = createDeploymentMatrixReport({ reportDir: options.reportDir });

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
            code: 'DEPLOYMENT_MATRIX_FAILED',
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
