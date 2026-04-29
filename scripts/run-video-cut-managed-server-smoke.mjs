#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createHttpWorkflowSmokeReport } from './run-video-cut-http-workflow-smoke.mjs';

const REPORT_VERSION = 'video-cut.managed-server-workflow-smoke.v1';
const API_ROUTE_PREFIX = '/api/video-cut/v1';

export function parseManagedServerSmokeArgs(argv, env = process.env) {
  const args = [...argv];
  let profile = 'server-dev';
  let deploymentMode = 'server-private';
  let bindHost = '127.0.0.1';
  let port = Number(env.SDKWORK_VIDEO_CUT_PORT || 0);
  let hostUrl = '';
  let authToken = env.SDKWORK_VIDEO_CUT_SERVER_TOKEN || '';
  let workspaceRoot = '';
  let fixtureDir = 'artifacts/smoke';
  let ffmpegPath = env.SDKWORK_VIDEO_CUT_FFMPEG_PATH || 'ffmpeg';
  let sourceFile = '';
  let keepWorkspace = false;
  let json = false;
  let reportPath = '';
  let timeoutMs = 120_000;

  if (args[0] && !args[0].startsWith('-')) {
    profile = args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--keep-workspace') {
      keepWorkspace = true;
      continue;
    }

    if (arg === '--deployment-mode') {
      deploymentMode = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--bind-host') {
      bindHost = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--port') {
      port = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--host-url' || arg === '--base-url') {
      hostUrl = normalizeHostUrl(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--server-token') {
      authToken = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--workspace-root') {
      workspaceRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--fixture-dir') {
      fixtureDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--ffmpeg-path') {
      ffmpegPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--source-file') {
      sourceFile = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--report-path') {
      reportPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--timeout-ms') {
      timeoutMs = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown managed server smoke argument: ${arg}`);
  }

  if (!Number.isFinite(port) || port < 0 || port > 65535) {
    throw new Error('--port must be between 0 and 65535.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  if (!hostUrl && port > 0) {
    hostUrl = hostUrlFromBind(bindHost, port);
  }

  return {
    authToken,
    bindHost,
    deploymentMode,
    ffmpegPath,
    fixtureDir,
    hostUrl,
    json,
    keepWorkspace,
    port,
    profile,
    reportPath,
    sourceFile,
    timeoutMs,
    workspaceRoot,
  };
}

export async function createManagedServerWorkflowSmokeReport({
  authToken = '',
  bindHost = '127.0.0.1',
  deploymentMode = 'server-private',
  execFileSyncImpl = execFileSync,
  fetchImpl = fetch,
  fixtureDir = 'artifacts/smoke',
  ffmpegPath = 'ffmpeg',
  generatedAt = new Date().toISOString(),
  hostUrl = '',
  keepWorkspace = false,
  port = 0,
  portAllocator = allocateLocalPort,
  profile = 'server-dev',
  projectRoot = process.cwd(),
  reportPath = '',
  sourceFile = '',
  spawnImpl = spawn,
  timeoutMs = 120_000,
  tokenFactory = () => `managed-${randomUUID()}`,
  workflowSmokeImpl = createHttpWorkflowSmokeReport,
  workspaceRoot = '',
} = {}) {
  const checks = [];
  const resolvedPort = port > 0 ? port : await portAllocator();
  const resolvedHostUrl = normalizeHostUrl(hostUrl || hostUrlFromBind(bindHost, resolvedPort));
  const serverToken = authToken || tokenFactory();
  const workspaceWasGenerated = !workspaceRoot;
  const resolvedWorkspaceRoot = resolve(
    projectRoot,
    workspaceRoot || `artifacts/runtime/managed-server-smoke-workspace-${resolvedPort}-${Date.now()}`,
  );
  const logPrefix = resolve(projectRoot, `artifacts/runtime/managed-server-smoke-${resolvedPort}`);
  const hostBinaryPath = resolve(projectRoot, 'host', 'target', 'debug', hostBinaryName());
  let child;

  try {
    mkdirSync(resolvedWorkspaceRoot, { recursive: true });
    mkdirSync(dirname(logPrefix), { recursive: true });
    execFileSyncImpl('cargo', ['build', '--manifest-path', 'host/Cargo.toml', '--bin', 'sdkwork-video-cut-host'], {
      cwd: projectRoot,
      stdio: 'pipe',
    });
    addCheck(checks, 'hostBuild', 'ok', 'Rust Host binary builds before managed server smoke.', {
      binary: 'host/target/debug/sdkwork-video-cut-host',
    });

    child = spawnImpl(hostBinaryPath, [], {
      cwd: projectRoot,
      env: {
        ...process.env,
        SDKWORK_VIDEO_CUT_AUTH_MODE: 'single-user-token',
        SDKWORK_VIDEO_CUT_BIND_HOST: bindHost,
        SDKWORK_VIDEO_CUT_PORT: String(resolvedPort),
        SDKWORK_VIDEO_CUT_PUBLIC_BASE_URL: `http://${bindHost}:${resolvedPort}`,
        SDKWORK_VIDEO_CUT_RUNTIME_MODE: deploymentMode,
        SDKWORK_VIDEO_CUT_SERVER_TOKEN: serverToken,
        SDKWORK_VIDEO_CUT_WORKSPACE_ROOT: resolvedWorkspaceRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    attachProcessLogs(child, `${logPrefix}.out.log`, `${logPrefix}.err.log`);
    addCheck(checks, 'hostStart', child?.pid ? 'ok' : 'fail', 'Managed server-private Host process starts.', {
      pid: child?.pid ?? null,
    });

    await waitForHostHealth(fetchImpl, resolvedHostUrl, timeoutMs);
    addCheck(checks, 'hostHealth', 'ok', 'Managed server-private Host health endpoint is reachable.');

    const workflow = await workflowSmokeImpl({
      authToken: serverToken,
      deploymentMode,
      fetchImpl,
      fixtureDir,
      ffmpegPath,
      hostUrl: resolvedHostUrl,
      profile,
      sourceFile,
      timeoutMs,
    });
    addCheck(checks, 'workflowSmoke', workflow?.ok === true ? 'ok' : 'fail', 'HTTP workflow smoke passes against the managed server-private Host.', {
      workflowSummary: workflow?.summary,
    });

    const cleanupStatus = cleanupProcess(child);
    child = undefined;
    addCheck(checks, 'processCleanup', cleanupStatus ? 'ok' : 'warn', 'Managed Host process cleanup completed.');

    const reportDraft = {
      deploymentMode,
      generatedAt,
      hostUrl: resolvedHostUrl,
      ok: false,
      profile,
      reportVersion: REPORT_VERSION,
      runtime: {
        authMode: 'single-user-token',
        bindHost,
        port: resolvedPort,
        workspaceRoot: workspaceWasGenerated ? '<generated-workspace>' : '<configured-workspace>',
      },
      workflow: sanitizeWorkflowEvidence(workflow),
    };
    const redactionStatus = reportContainsSensitiveData(reportDraft, serverToken) ? 'fail' : 'ok';
    addCheck(checks, 'redaction', redactionStatus, 'Managed server smoke report does not include secrets or raw environment values.');

    const summary = summarizeChecks(checks);
    const report = redactReport({
      ...reportDraft,
      checks,
      ok: summary.fail === 0,
      summary,
    });
    writeReportIfRequested(reportPath, report);
    return report;
  } finally {
    if (child) {
      cleanupProcess(child);
    }
    if (workspaceWasGenerated && !keepWorkspace) {
      rmSync(resolvedWorkspaceRoot, { force: true, recursive: true });
    }
  }
}

function writeReportIfRequested(reportPath, report) {
  if (!reportPath) {
    return;
  }

  const outputPath = resolve(reportPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function normalizeHostUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function hostUrlFromBind(bindHost, port) {
  return `http://${bindHost}:${port}${API_ROUTE_PREFIX}`;
}

function hostBinaryName() {
  return process.platform === 'win32' ? 'sdkwork-video-cut-host.exe' : 'sdkwork-video-cut-host';
}

async function allocateLocalPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function attachProcessLogs(child, stdoutPath, stderrPath) {
  if (child?.stdout?.on) {
    child.stdout.on('data', (chunk) => appendFileSync(stdoutPath, chunk));
  }
  if (child?.stderr?.on) {
    child.stderr.on('data', (chunk) => appendFileSync(stderrPath, chunk));
  }
}

async function waitForHostHealth(fetchImpl, hostUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${hostUrl}/health`, {
        headers: {
          accept: 'application/json',
        },
        method: 'GET',
      });
      const body = await response.json();
      if (response.ok && body?.ok === true && body?.data?.status === 'ok') {
        return;
      }
      lastError = new Error(`Health endpoint returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(`Managed Host did not become healthy within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function cleanupProcess(child) {
  if (!child || child.killed) {
    return true;
  }

  try {
    return child.kill();
  } catch {
    return false;
  }
}

function addCheck(checks, checkId, status, label, details = {}) {
  checks.push({
    checkId,
    details,
    label,
    status: status === 'fail' || status === 'warn' ? status : 'ok',
  });
}

function sanitizeWorkflowEvidence(workflow) {
  return redactReport({
    artifacts: summarizeWorkflowArtifacts(workflow?.artifacts),
    checks: Array.isArray(workflow?.checks)
      ? workflow.checks.map((check) => ({
          checkId: check?.checkId,
          status: check?.status,
        }))
      : [],
    deploymentMode: workflow?.deploymentMode,
    ok: workflow?.ok === true,
    reportVersion: workflow?.reportVersion,
    source: workflow?.source
      ? {
          fileName: workflow.source.fileName,
          generated: workflow.source.generated,
          sizeBytes: workflow.source.sizeBytes,
        }
      : undefined,
    summary: workflow?.summary,
    taskId: workflow?.taskId,
  });
}

function summarizeWorkflowArtifacts(artifacts) {
  if (!artifacts || typeof artifacts !== 'object') {
    return undefined;
  }

  return {
    log: summarizeWorkflowArtifact(artifacts.log),
    manifest: summarizeWorkflowArtifact(artifacts.manifest),
    output: summarizeWorkflowArtifact(artifacts.output),
  };
}

function summarizeWorkflowArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    return undefined;
  }

  return {
    artifactId: artifact.artifactId,
    bytesChecked: artifact.bytesChecked,
    contentType: artifact.contentType,
    downloadMode: artifact.downloadMode,
    kind: artifact.kind,
    mp4Signature: artifact.mp4Signature,
    rangeBytesChecked: artifact.rangeBytesChecked,
    rangeChecked: artifact.rangeChecked,
    securityHeadersChecked: artifact.securityHeadersChecked,
    sizeBytes: artifact.sizeBytes,
  };
}

function summarizeChecks(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { ok: 0, warn: 0, fail: 0 },
  );
}

function reportContainsSensitiveData(report, token) {
  const serialized = JSON.stringify(report);
  const trimmedToken = String(token || '').trim();
  return Boolean(
    (trimmedToken && serialized.includes(trimmedToken)) ||
      serialized.includes('SDKWORK_VIDEO_CUT_SERVER_TOKEN') ||
      serialized.includes('"apiKey"') ||
      /\bsk-[A-Za-z0-9_-]{8,}/.test(serialized),
  );
}

function redactReport(report) {
  return JSON.parse(
    JSON.stringify(report, (key, value) => {
      if (key === 'token' || key === 'serverToken' || key === 'authToken' || key === 'apiKey') {
        return undefined;
      }

      return value;
    }),
  );
}

function printHumanReport(report) {
  const lines = [
    'SDKWork Video Cut Managed Server Workflow Smoke',
    `profile: ${report.profile}`,
    `deploymentMode: ${report.deploymentMode}`,
    `hostUrl: ${report.hostUrl}`,
    `summary: ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    '',
    ...report.checks.map((check) => `${check.status.toUpperCase()} ${check.checkId}: ${check.label}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

async function main() {
  try {
    const options = parseManagedServerSmokeArgs(process.argv.slice(2));
    const report = await createManagedServerWorkflowSmokeReport(options);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report);
    }

    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const failure = {
      error: {
        code: 'MANAGED_SERVER_WORKFLOW_SMOKE_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
      ok: false,
      reportVersion: REPORT_VERSION,
    };
    process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (isDirectRun(import.meta.url)) {
  void main();
}
