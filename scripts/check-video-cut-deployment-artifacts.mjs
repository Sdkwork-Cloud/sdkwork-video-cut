#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import YAML from 'yaml';

import { normalizeCliArgs } from './lib/cli-args.mjs';
import { createReportPath } from './lib/report-paths.mjs';

const COMMAND = 'check:deployment-artifacts';
const REPORT_VERSION = 'video-cut.deployment-artifacts-report.v1';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const CANONICAL_API_ROUTE = '/api/video-cut/v1';

const REQUIRED_KUBERNETES_FILES = [
  'deploy/kubernetes/Chart.yaml',
  'deploy/kubernetes/values.yaml',
  'deploy/kubernetes/templates/configmap.yaml',
  'deploy/kubernetes/templates/deployment.yaml',
  'deploy/kubernetes/templates/hpa.yaml',
  'deploy/kubernetes/templates/ingress.yaml',
  'deploy/kubernetes/templates/pvc.yaml',
  'deploy/kubernetes/templates/secret.yaml',
  'deploy/kubernetes/templates/service.yaml',
];

export function parseDeploymentArtifactsArgs(argv) {
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

    throw new Error(`Unknown deployment artifacts argument: ${arg}`);
  }

  return { json, reportDir };
}

export function createDeploymentArtifactsReport({
  projectRoot = process.cwd(),
  reportDir = DEFAULT_REPORT_DIR,
} = {}) {
  const packageJson = readJson(projectRoot, 'package.json');
  const checks = [
    checkTauriDesktopShell(projectRoot, packageJson),
    checkWebFavicon(projectRoot),
    checkDockerfile(projectRoot),
    checkDockerCompose(projectRoot),
    checkKubernetesChart(projectRoot),
    checkEnvExample(projectRoot),
    checkRuntimeProfiles(projectRoot),
  ];
  const summary = summarizeChecks(checks);
  const { absolutePath, reportPath } = createReportPath(
    projectRoot,
    reportDir,
    'deployment-artifacts-report.json',
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

function checkTauriDesktopShell(projectRoot, packageJson) {
  const tauriConfig = readJson(projectRoot, 'src-tauri/tauri.conf.json');
  const tauriCargo = readText(projectRoot, 'src-tauri/Cargo.toml');
  const tauriMain = readText(projectRoot, 'src-tauri/src/main.rs');
  const tauriDev = readText(projectRoot, 'scripts/run-video-cut-tauri-dev.mjs');
  const devStack = readText(projectRoot, 'scripts/run-video-cut-tauri-dev-stack.mjs');
  const errors = [
    ...requireFiles(projectRoot, [
      'src-tauri/icons/icon.ico',
      'src-tauri/Cargo.toml',
      'src-tauri/tauri.conf.json',
      'src-tauri/src/main.rs',
      'scripts/run-video-cut-tauri-dev.mjs',
      'scripts/run-video-cut-tauri-dev-stack.mjs',
    ]),
    ...(packageJson.scripts?.['tauri:dev'] === 'node scripts/run-video-cut-tauri-dev.mjs'
      ? []
      : ['tauri:dev script must use scripts/run-video-cut-tauri-dev.mjs']),
    ...(packageJson.scripts?.['tauri:before-dev'] === 'node scripts/run-video-cut-tauri-dev-stack.mjs'
      ? []
      : ['tauri:before-dev script must use scripts/run-video-cut-tauri-dev-stack.mjs']),
    ...(packageJson.devDependencies?.['@tauri-apps/cli'] ? [] : ['@tauri-apps/cli dev dependency missing']),
    ...(tauriConfig?.build?.beforeDevCommand === 'pnpm tauri:before-dev'
      ? []
      : ['tauri beforeDevCommand must delegate to pnpm tauri:before-dev']),
    ...(tauriConfig?.build?.devUrl === 'http://127.0.0.1:5173' ? [] : ['tauri devUrl must use local Vite URL']),
    ...(tauriConfig?.build?.frontendDist === '../dist' ? [] : ['tauri frontendDist must use ../dist']),
    ...(JSON.stringify(tauriConfig).includes('icons/icon.ico') ? [] : ['tauri config must reference icons/icon.ico']),
    ...(tauriConfig?.app?.windows?.[0]?.label === 'main' ? [] : ['tauri main window label must be main']),
    ...(tauriConfig?.app?.windows?.[0]?.title === 'SDKWork Video Cut'
      ? []
      : ['tauri main window title must be SDKWork Video Cut']),
    ...(tauriCargo.includes('name = "sdkwork-video-cut-desktop"') ? [] : ['tauri Cargo package name drifted']),
    ...(tauriCargo.includes('tauri = ') ? [] : ['tauri dependency missing']),
    ...(tauriMain.includes('tauri::Builder::default()') ? [] : ['tauri main must build a Tauri shell']),
    ...(!tauriMain.includes('ffmpeg') ? [] : ['tauri shell must not call ffmpeg directly']),
    ...(!tauriMain.includes(CANONICAL_API_ROUTE) ? [] : ['tauri shell must not bind business API routes']),
    ...(tauriDev.includes('--no-dev-server-wait') ? [] : ['tauri dev script must avoid duplicate dev-server wait']),
    ...(tauriDev.includes('beforeDevCommand') ? [] : ['tauri dev script must inspect beforeDevCommand']),
    ...(tauriDev.includes('createBrowserChildProcessEnv') ? [] : ['tauri dev script must sanitize browser env']),
    ...(devStack.includes('SDKWORK_VIDEO_CUT_RUNTIME_MODE') ? [] : ['dev stack must use SDKWORK runtime mode']),
    ...(devStack.includes('createBrowserChildProcessEnv') ? [] : ['dev stack must sanitize browser env']),
    ...(!devStack.includes('VITE_VIDEO_CUT_HOST_MODE') ? [] : ['dev stack must not use VITE host mode']),
    ...(!devStack.includes('VITE_VIDEO_CUT_HOST_BASE_URL') ? [] : ['dev stack must not use VITE host base URL']),
    ...(devStack.includes("'exec', 'vite'") ? [] : ['dev stack must launch Vite through exec']),
    ...(devStack.includes('http://127.0.0.1:6177/api/video-cut/v1')
      ? []
      : ['dev stack must target the canonical local Host API URL']),
  ];

  return checkResult({
    id: 'tauri-desktop-shell-contract',
    passed: errors.length === 0,
    evidence: 'Tauri desktop shell delegates business work to the Host API and sanitizes browser runtime env.',
    failMessage: `Tauri desktop shell drift: ${errors.join('; ')}`,
  });
}

function checkWebFavicon(projectRoot) {
  const indexHtml = readText(projectRoot, 'index.html');
  const errors = [
    ...(!indexHtml.includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
      ? ['index.html must declare /favicon.svg']
      : []),
    ...requireFiles(projectRoot, ['public/favicon.svg']),
  ];

  return checkResult({
    id: 'web-favicon-contract',
    passed: errors.length === 0,
    evidence: 'Browser and desktop webviews have an explicit SVG favicon.',
    failMessage: `Web favicon drift: ${errors.join('; ')}`,
  });
}

function checkDockerfile(projectRoot) {
  const dockerfile = readText(projectRoot, 'deploy/docker/Dockerfile');
  const errors = [
    ...requireText(dockerfile, [
      'AS frontend-build',
      'AS host-build',
      'AS host-runtime',
      'AS web-runtime',
      'SDKWORK_VIDEO_CUT_BIND_HOST=0.0.0.0',
      'SDKWORK_VIDEO_CUT_PORT=6177',
      'SDKWORK_VIDEO_CUT_WORKSPACE_ROOT=/data/workspace',
    ]),
    ...forbidText(dockerfile, ['VITE_VIDEO_CUT_HOST_MODE', 'VITE_VIDEO_CUT_HOST_BASE_URL']),
  ];

  return checkResult({
    id: 'dockerfile-multi-target-contract',
    passed: errors.length === 0,
    evidence: 'Dockerfile declares frontend-build, host-build, host-runtime, and web-runtime targets.',
    failMessage: `Dockerfile drift: ${errors.join('; ')}`,
  });
}

function checkDockerCompose(projectRoot) {
  const composeText = readText(projectRoot, 'deploy/docker/docker-compose.yml');
  const compose = parseYaml(composeText);
  const hostService = compose?.services?.['video-cut-host'] ?? {};
  const errors = [
    ...(compose?.services?.['video-cut-host'] ? [] : ['video-cut-host service missing']),
    ...(compose?.services?.['video-cut-web'] ? [] : ['video-cut-web service missing']),
    ...(compose?.volumes?.['video-cut-workspace'] ? [] : ['video-cut-workspace volume missing']),
    ...(Object.hasOwn(hostService, 'ports') ? ['video-cut-host must not publish ports directly'] : []),
    ...(Array.isArray(hostService.expose) && hostService.expose.map(String).includes('6177')
      ? []
      : ['video-cut-host must expose 6177 only to the compose network']),
    ...requireText(composeText, [
      '/api/video-cut/v1/health',
      'container-private',
      'SDKWORK_VIDEO_CUT_AUTH_MODE',
      'SDKWORK_VIDEO_CUT_STT_PROVIDER_PROFILE',
      'SDKWORK_VIDEO_CUT_STT_RESOURCE_ID',
      'reverse-proxy',
    ]),
  ];

  return checkResult({
    id: 'docker-compose-private-runtime-contract',
    passed: errors.length === 0,
    evidence: 'Docker Compose declares private Host plus web proxy with reverse-proxy auth.',
    failMessage: `Docker Compose drift: ${errors.join('; ')}`,
  });
}

function checkKubernetesChart(projectRoot) {
  const chart = readYaml(projectRoot, 'deploy/kubernetes/Chart.yaml');
  const valuesText = readText(projectRoot, 'deploy/kubernetes/values.yaml');
  const deploymentText = readText(projectRoot, 'deploy/kubernetes/templates/deployment.yaml');
  const serviceText = readText(projectRoot, 'deploy/kubernetes/templates/service.yaml');
  const errors = [
    ...requireFiles(projectRoot, REQUIRED_KUBERNETES_FILES),
    ...(chart?.name === 'sdkwork-video-cut' ? [] : ['Chart.yaml name must be sdkwork-video-cut']),
    ...requireText(valuesText, [
      'deploymentMode: kubernetes-private',
      'authMode: reverse-proxy',
      'secretProvider: kubernetes-secret',
      'speechToText:',
      'providerProfile: openai-audio-transcriptions',
      'resourceId: volc.bigasr.auc',
    ]),
    ...forbidText(valuesText, ['hostPort:']),
    ...requireText(deploymentText, [
      'SDKWORK_VIDEO_CUT_BIND_HOST',
      'SDKWORK_VIDEO_CUT_PORT',
      'SDKWORK_VIDEO_CUT_WORKSPACE_ROOT',
      'SDKWORK_VIDEO_CUT_STT_PROVIDER_PROFILE',
      'SDKWORK_VIDEO_CUT_STT_RESOURCE_ID',
      '/api/video-cut/v1/health',
    ]),
    ...requireText(serviceText, ['name: http']),
    ...forbidText(serviceText, ['name: host', 'targetPort: host']),
  ];

  return checkResult({
    id: 'kubernetes-chart-private-runtime-contract',
    passed: errors.length === 0,
    evidence: 'Kubernetes chart exposes the web/http proxy and keeps Host private.',
    failMessage: `Kubernetes chart drift: ${errors.join('; ')}`,
  });
}

function checkEnvExample(projectRoot) {
  const envExample = readText(projectRoot, '.env.example');
  const errors = [
    ...requireText(envExample, [
      'SDKWORK_VIDEO_CUT_WORKSPACE_ROOT=./workspace',
      'SDKWORK_VIDEO_CUT_RUNTIME_MODE=desktop-local',
      'SDKWORK_VIDEO_CUT_STT_PROVIDER_PROFILE=openai-audio-transcriptions',
      'SDKWORK_VIDEO_CUT_STT_RESOURCE_ID=volc.bigasr.auc',
    ]),
    ...(/^VIDEO_CUT_WORKSPACE_ROOT=/m.test(envExample) ? ['legacy VIDEO_CUT_WORKSPACE_ROOT must not be defined'] : []),
    ...(/^VIDEO_CUT_HOST_BIND=/m.test(envExample) ? ['legacy VIDEO_CUT_HOST_BIND must not be defined'] : []),
  ];

  return checkResult({
    id: 'env-example-standard-prefix-contract',
    passed: errors.length === 0,
    evidence: '.env.example uses SDKWORK_VIDEO_CUT_* runtime variables and no legacy aliases.',
    failMessage: `.env.example drift: ${errors.join('; ')}`,
  });
}

function checkRuntimeProfiles(projectRoot) {
  const registry = readYaml(projectRoot, 'deploy/runtime-profiles.yaml');
  const profiles = Array.isArray(registry?.profiles) ? registry.profiles : [];
  const byMode = new Map(profiles.map((profile) => [profile.deploymentMode, profile]));
  const requiredModes = ['desktop-local', 'server-private', 'web-private', 'container-private', 'kubernetes-private'];
  const errors = [
    ...(registry?.registryVersion === 'video-cut.runtime-profile-registry.v1'
      ? []
      : ['registryVersion must be video-cut.runtime-profile-registry.v1']),
    ...requiredModes.filter((mode) => !byMode.has(mode)).map((mode) => `runtime profile missing: ${mode}`),
    ...profileMatches(byMode.get('desktop-local'), {
      profileId: 'video-cut.desktop-local.v1',
      readinessLevel: 'prod-ready',
      apiContract: CANONICAL_API_ROUTE,
      storageProvider: 'filesystem',
      secretProvider: 'local-secure-store',
    }),
    ...profileMatches(byMode.get('server-private'), {
      profileId: 'video-cut.server-private.v1',
      readinessLevel: 'prod-ready',
      authMode: 'single-user-token',
      secretProvider: 'env',
    }),
    ...profileMatches(byMode.get('container-private'), {
      readinessLevel: 'prod-ready',
      authMode: 'reverse-proxy',
      secretProvider: 'env',
    }),
    ...profileMatches(byMode.get('kubernetes-private'), {
      readinessLevel: 'smoke-ready',
      authMode: 'reverse-proxy',
      secretProvider: 'kubernetes-secret',
      replicaPolicy: 'single-replica-until-shared-db-and-object-storage',
    }),
    ...profiles
      .filter((profile) => !Array.isArray(profile.requiredChecks) || !profile.requiredChecks.includes('health'))
      .map((profile) => `${profile.deploymentMode} must require health check`),
    ...profiles
      .filter((profile) => !Array.isArray(profile.requiredChecks) || !profile.requiredChecks.includes('capability'))
      .map((profile) => `${profile.deploymentMode} must require capability check`),
    ...profiles
      .filter((profile) => profile.readinessLevel === 'scale-ready')
      .map((profile) => `${profile.deploymentMode} must not claim scale-ready`),
  ];

  return checkResult({
    id: 'runtime-profiles-contract',
    passed: errors.length === 0,
    evidence: 'Runtime profiles cover desktop-local, server-private, web-private, container-private, and kubernetes-private.',
    failMessage: `Runtime profile registry drift: ${errors.join('; ')}`,
  });
}

function profileMatches(profile, expected) {
  if (!profile) {
    return [`profile missing for expected ${JSON.stringify(expected)}`];
  }

  return Object.entries(expected)
    .filter(([key, value]) => profile[key] !== value)
    .map(([key, value]) => `${profile.deploymentMode}.${key} must be ${value}`);
}

function requireFiles(projectRoot, files) {
  return files.filter((file) => !existsSync(resolve(projectRoot, file))).map((file) => `${file} missing`);
}

function requireText(text, tokens) {
  return tokens.filter((token) => !text.includes(token)).map((token) => `missing token: ${token}`);
}

function forbidText(text, tokens) {
  return tokens.filter((token) => text.includes(token)).map((token) => `forbidden token: ${token}`);
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

function readJson(projectRoot, path) {
  const text = readText(projectRoot, path);
  return text ? JSON.parse(text) : {};
}

function readYaml(projectRoot, path) {
  return parseYaml(readText(projectRoot, path));
}

function parseYaml(text) {
  return text ? YAML.parse(text) : {};
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
    'SDKWork Video Cut Deployment Artifacts',
    `status: ${report.status}`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    `reportPath: ${report.reportPath}`,
    '',
    ...report.checks.map((check) => `${check.status.toUpperCase()} ${check.id}: ${check.evidence}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main() {
  try {
    const options = parseDeploymentArtifactsArgs(process.argv.slice(2));
    const report = createDeploymentArtifactsReport({ reportDir: options.reportDir });

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
            code: 'DEPLOYMENT_ARTIFACTS_FAILED',
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
