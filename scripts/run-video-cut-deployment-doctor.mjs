#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_HOST_URL = 'http://127.0.0.1:6177/api/video-cut/v1';
const REPORT_VERSION = 'video-cut.deployment-doctor.cli.v1';
const REDACTED_PATH = '<redacted-path>';

export function parseDoctorArgs(argv, env = process.env) {
  const args = [...argv];
  let profile = 'desktop-dev';
  let deploymentMode = 'desktop-local';
  let hostUrl = env.SDKWORK_VIDEO_CUT_HOST_URL || env.VITE_VIDEO_CUT_HOST_BASE_URL || DEFAULT_HOST_URL;
  let authToken = env.SDKWORK_VIDEO_CUT_SERVER_TOKEN || env.VITE_VIDEO_CUT_SERVER_TOKEN || '';
  let json = false;
  let timeoutMs = 10_000;

  if (args[0] && !args[0].startsWith('-')) {
    profile = args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--deployment-mode') {
      deploymentMode = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--host-url' || arg === '--base-url') {
      hostUrl = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--server-token') {
      authToken = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--timeout-ms') {
      timeoutMs = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown deployment doctor argument: ${arg}`);
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  return {
    authToken,
    deploymentMode,
    hostUrl: normalizeHostUrl(hostUrl),
    json,
    profile,
    timeoutMs,
  };
}

export async function createDeploymentDoctorReport({
  authToken = '',
  deploymentMode = 'desktop-local',
  fetchImpl = fetch,
  hostUrl = DEFAULT_HOST_URL,
  profile = 'desktop-dev',
  timeoutMs = 10_000,
} = {}) {
  const normalizedHostUrl = normalizeHostUrl(hostUrl);
  const health = await requestEnvelope(fetchImpl, normalizedHostUrl, '/health', timeoutMs, authToken);
  const capability = await requestEnvelope(fetchImpl, normalizedHostUrl, '/capabilities', timeoutMs, authToken);
  const doctor = await requestEnvelope(fetchImpl, normalizedHostUrl, '/doctor', timeoutMs, authToken);
  const checks = Array.isArray(doctor.checks) ? doctor.checks.map(normalizeCheck) : [];
  const summary = summarizeChecks(checks);
  const ok = summary.fail === 0 && health.status === 'ok' && doctor.reportVersion === 'video-cut.doctor.v1';

  return redactReport({
    reportVersion: REPORT_VERSION,
    ok,
    profile,
    deploymentMode,
    hostUrl: normalizedHostUrl,
    generatedAt: new Date().toISOString(),
    health: ok ? doctor.health : 'unavailable',
    hostHealth: health,
    capability,
    doctor,
    checks,
    summary,
  });
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function normalizeHostUrl(value) {
  return String(value || DEFAULT_HOST_URL).replace(/\/+$/, '');
}

async function requestEnvelope(fetchImpl, hostUrl, path, timeoutMs, authToken = '') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const token = String(authToken || '').trim();

  try {
    const response = await fetchImpl(`${hostUrl}${path}`, {
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      method: 'GET',
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok || body?.ok !== true) {
      const code = body?.error?.code || `HTTP_${response.status}`;
      const message = body?.error?.message || `Deployment doctor request failed: ${path}`;
      throw new Error(`${code}: ${message}`);
    }

    return body.data;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCheck(check) {
  return {
    checkId: String(check.checkId || check.id || 'unknown'),
    status: check.status === 'fail' || check.status === 'warn' ? check.status : 'ok',
    label: String(check.label || check.message || check.checkId || 'Deployment check'),
    ...(check.actionHint ? { actionHint: String(check.actionHint) } : {}),
    ...(check.details ? { details: check.details } : {}),
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

function redactReport(report) {
  return JSON.parse(
    JSON.stringify(report, (key, value) => {
      if (key === 'apiKey' || key === 'token' || key === 'serverToken' || key === 'authToken' || key === 'authorization') {
        return undefined;
      }

      if (typeof value === 'string' && shouldRedactLocalPath(key, value)) {
        return REDACTED_PATH;
      }

      return value;
    }),
  );
}

function shouldRedactLocalPath(key, value) {
  const normalizedKey = String(key || '').toLowerCase();
  const isPathField =
    normalizedKey === 'path' ||
    normalizedKey.endsWith('path') ||
    normalizedKey.endsWith('root') ||
    normalizedKey.includes('workspace') ||
    normalizedKey.includes('artifact') ||
    normalizedKey.includes('temp');

  return isPathField && isAbsoluteLocalPath(value);
}

function isAbsoluteLocalPath(value) {
  const trimmed = String(value || '').trim();
  return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.startsWith('/');
}

function printHumanReport(report) {
  const lines = [
    `SDKWork Video Cut Deployment Doctor`,
    `profile: ${report.profile}`,
    `deploymentMode: ${report.deploymentMode}`,
    `hostUrl: ${report.hostUrl}`,
    `health: ${report.health}`,
    `summary: ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    '',
    ...report.checks.map((check) => {
      const hint = check.actionHint ? ` (${check.actionHint})` : '';
      return `${check.status.toUpperCase()} ${check.checkId}: ${check.label}${hint}`;
    }),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

async function main() {
  try {
    const options = parseDoctorArgs(process.argv.slice(2));
    const report = await createDeploymentDoctorReport({
      deploymentMode: options.deploymentMode,
      authToken: options.authToken,
      hostUrl: options.hostUrl,
      profile: options.profile,
      timeoutMs: options.timeoutMs,
    });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report);
    }

    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const failure = {
      reportVersion: REPORT_VERSION,
      ok: false,
      error: {
        code: 'DEPLOYMENT_DOCTOR_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    };
    process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (isDirectRun(import.meta.url)) {
  void main();
}
