#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { normalizeCliArgs } from '../lib/cli-args.mjs';
import { createRemediationActions } from '../lib/release-remediation-summary.mjs';
import { createReportPath } from '../lib/report-paths.mjs';
import {
  findLocalAbsolutePath,
  redactReport,
  reportContainsSensitiveData,
  sanitizeErrorMessage,
} from '../lib/report-safety.mjs';

const REPORT_VERSION = 'video-cut.release-smoke-preflight-report.v1';
const COMMAND = 'release:smoke:preflight';
const DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release-smoke-matrix';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const DEFAULT_BIND_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 15_000;
const REQUIRED_PORT_COUNT = 2;

export function parseReleaseSmokePreflightArgs(argv, env = process.env) {
  const args = normalizeCliArgs(argv);
  let bindHost = env.SDKWORK_VIDEO_CUT_BIND_HOST || DEFAULT_BIND_HOST;
  let cargoPath = env.SDKWORK_VIDEO_CUT_CARGO_PATH || 'cargo';
  let chromeExecutablePath = env.SDKWORK_VIDEO_CUT_CHROME_EXECUTABLE_PATH || '';
  let ffmpegPath = env.SDKWORK_VIDEO_CUT_FFMPEG_PATH || 'ffmpeg';
  let json = false;
  let releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR;
  let reportDir = DEFAULT_REPORT_DIR;
  let smokeReportDir = '';
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--bind-host') {
      bindHost = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--cargo-path') {
      cargoPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--chrome-executable-path') {
      chromeExecutablePath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--ffmpeg-path') {
      ffmpegPath = requireValue(args, index, arg);
      index += 1;
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

    if (arg === '--smoke-report-dir') {
      smokeReportDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--timeout-ms') {
      timeoutMs = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown release smoke preflight argument: ${arg}`);
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const normalizedSmokeReportDir = normalizeProjectPath(smokeReportDir || `${normalizedReleaseAssetsDir}/smoke`);
  assertProjectRelativePath('smokeReportDir', normalizedSmokeReportDir);

  return {
    bindHost,
    cargoPath,
    chromeExecutablePath,
    ffmpegPath,
    json,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    reportDir: normalizeProjectPath(reportDir),
    smokeReportDir: normalizedSmokeReportDir,
    timeoutMs,
  };
}

export async function createReleaseSmokePreflightReport({
  bindHost = DEFAULT_BIND_HOST,
  cargoPath = 'cargo',
  chromeExecutablePath = '',
  ffmpegPath = 'ffmpeg',
  projectRoot = process.cwd(),
  releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR,
  reportDir = DEFAULT_REPORT_DIR,
  smokeReportDir = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  probes = defaultReleaseSmokePreflightProbes(),
} = {}) {
  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const normalizedReportDir = normalizeProjectPath(reportDir);
  const normalizedSmokeReportDir = normalizeProjectPath(smokeReportDir || `${normalizedReleaseAssetsDir}/smoke`);
  assertProjectRelativePath('smokeReportDir', normalizedSmokeReportDir);

  const checks = [
    checkRequiredFile(projectRoot, 'host/Cargo.toml', 'release-smoke-preflight-host-cargo-manifest'),
    checkRequiredFile(projectRoot, 'node_modules/vite/bin/vite.js', 'release-smoke-preflight-vite-bin'),
    await checkCommand({
      args: ['-version'],
      command: ffmpegPath,
      evidenceLabel: 'FFmpeg command can be spawned for fixture generation and render smoke.',
      id: 'release-smoke-preflight-ffmpeg-spawn',
      probes,
      projectRoot,
      timeoutMs,
    }),
    await checkCommand({
      args: ['--version'],
      command: cargoPath,
      evidenceLabel: 'Cargo command can be spawned for managed Host build smoke.',
      id: 'release-smoke-preflight-cargo-spawn',
      probes,
      projectRoot,
      timeoutMs,
    }),
    await checkBrowserExecutable({
      chromeExecutablePath,
      probes,
      timeoutMs,
    }),
    await checkLocalPorts({
      bindHost,
      count: REQUIRED_PORT_COUNT,
      probes,
      timeoutMs,
    }),
    await checkWritableDirectories({
      paths: [normalizedReleaseAssetsDir, normalizedSmokeReportDir, normalizedReportDir, 'artifacts/runtime'],
      probes,
      projectRoot,
    }),
  ];

  const summaryBeforeSafety = summarizeChecks(checks);
  const environmentBlockersBeforeSafety = createEnvironmentBlockers(checks);
  const runnerConfig = createRunnerConfigEvidence({
    bindHost,
    cargoPath,
    chromeExecutablePath,
    ffmpegPath,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    reportDir: normalizedReportDir,
    smokeReportDir: normalizedSmokeReportDir,
    timeoutMs,
  });
  const remediationActionsBeforeSafety = createRemediationActions(environmentBlockersBeforeSafety);
  const { absolutePath, reportPath } = createReportPath(
    projectRoot,
    normalizedReportDir,
    'release-smoke-preflight-report.json',
  );
  const reportDraft = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summaryBeforeSafety.fail === 0 ? 'pass' : 'fail',
    environmentStatus: summaryBeforeSafety.fail === 0 ? 'ready' : 'blocked',
    environmentBlockers: environmentBlockersBeforeSafety,
    generatedAt: new Date().toISOString(),
    releaseAssetsDir: normalizedReleaseAssetsDir,
    smokeReportDir: normalizedSmokeReportDir,
    runnerConfig,
    remediationActions: remediationActionsBeforeSafety,
    reportPath,
    summary: summaryBeforeSafety,
    checks,
  };
  const safeDraft = redactReport(reportDraft);
  const safetyCheck = checkResult({
    id: 'release-smoke-preflight-redaction-and-path-safety',
    passed: !reportContainsSensitiveData(safeDraft) && !findLocalAbsolutePath(safeDraft),
    evidence: 'Release smoke preflight report contains no credential-shaped values and no server-local absolute paths.',
    failMessage: `Release smoke preflight report must not contain sensitive data or local paths. Sensitive=${reportContainsSensitiveData(
      safeDraft,
    )} localPath=${findLocalAbsolutePath(safeDraft)}`,
  });
  const finalChecks = [...checks, safetyCheck];
  const summary = summarizeChecks(finalChecks);
  const environmentBlockers = createEnvironmentBlockers(finalChecks);
  const remediationActions = createRemediationActions(environmentBlockers);
  const report = redactReport({
    ...reportDraft,
    status: summary.fail === 0 ? 'pass' : 'fail',
    environmentStatus: summary.fail === 0 ? 'ready' : 'blocked',
    environmentBlockers,
    remediationActions,
    summary,
    checks: finalChecks,
  });

  writeReport(absolutePath, report);
  return report;
}

function createEnvironmentBlockers(checks) {
  return checks
    .filter((check) => check?.status === 'fail')
    .map((check) => ({
      id: check.id,
      code: classifyEnvironmentBlockerCode(check),
      category: classifyEnvironmentBlockerCategory(check),
      evidence: sanitizeErrorMessage(check.evidence || ''),
    }));
}

function createRunnerConfigEvidence({
  bindHost,
  cargoPath,
  chromeExecutablePath,
  ffmpegPath,
  releaseAssetsDir,
  reportDir,
  smokeReportDir,
  timeoutMs,
}) {
  return {
    bindHost,
    cargoPath: sanitizeRunnerPath(cargoPath),
    chromeExecutablePath: sanitizeRunnerPath(chromeExecutablePath),
    ffmpegPath: sanitizeRunnerPath(ffmpegPath),
    releaseAssetsDir,
    reportDir,
    smokeReportDir,
    timeoutMs,
  };
}

function sanitizeRunnerPath(value) {
  const raw = String(value || '');
  return findLocalAbsolutePath(raw) ? '<redacted-path>' : normalizeProjectPath(raw);
}

function classifyEnvironmentBlockerCode(check) {
  const id = String(check?.id || '');
  if (id.endsWith('-spawn')) {
    return 'RELEASE_SMOKE_ENV_TOOL_SPAWN_BLOCKED';
  }
  if (id === 'release-smoke-preflight-browser-executable') {
    return 'RELEASE_SMOKE_ENV_BROWSER_UNAVAILABLE';
  }
  if (id === 'release-smoke-preflight-local-ports') {
    return 'RELEASE_SMOKE_ENV_PORTS_UNAVAILABLE';
  }
  if (id === 'release-smoke-preflight-writable-directories') {
    return 'RELEASE_SMOKE_ENV_WORKSPACE_UNWRITABLE';
  }
  if (id === 'release-smoke-preflight-host-cargo-manifest' || id === 'release-smoke-preflight-vite-bin') {
    return 'RELEASE_SMOKE_ENV_REQUIRED_FILE_MISSING';
  }
  return 'RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED';
}

function classifyEnvironmentBlockerCategory(check) {
  const id = String(check?.id || '');
  if (id.endsWith('-spawn')) {
    return 'tool-spawn';
  }
  if (id === 'release-smoke-preflight-browser-executable') {
    return 'browser';
  }
  if (id === 'release-smoke-preflight-local-ports') {
    return 'network';
  }
  if (id === 'release-smoke-preflight-writable-directories') {
    return 'filesystem';
  }
  if (id === 'release-smoke-preflight-host-cargo-manifest' || id === 'release-smoke-preflight-vite-bin') {
    return 'required-file';
  }
  return 'preflight';
}

export function defaultReleaseSmokePreflightProbes() {
  return {
    browser: probeBrowserExecutable,
    command: probeCommand,
    localPorts: probeLocalPorts,
    writableDirectory: probeWritableDirectory,
  };
}

async function checkCommand({ args, command, evidenceLabel, id, probes, projectRoot, timeoutMs }) {
  try {
    const result = await probes.command({ args, command, projectRoot, timeoutMs });
    return checkResult({
      id,
      passed: result?.ok === true,
      evidence: `${evidenceLabel} ${String(result?.version || '').split('\n')[0]}`.trim(),
      failMessage: `${evidenceLabel} ${sanitizeErrorMessage(result?.error || result?.evidence || 'Command probe failed.')}`,
    });
  } catch (error) {
    return checkResult({
      id,
      passed: false,
      evidence: '',
      failMessage: `${evidenceLabel} ${sanitizeErrorMessage(error)}`,
    });
  }
}

function checkRequiredFile(projectRoot, path, id) {
  const exists = existsSync(resolve(projectRoot, path));
  return checkResult({
    id,
    passed: exists,
    evidence: `${path} exists.`,
    failMessage: `${path} is required before release smoke preflight can run.`,
  });
}

async function checkBrowserExecutable({ chromeExecutablePath, probes, timeoutMs }) {
  try {
    const result = await probes.browser({ chromeExecutablePath, timeoutMs });
    return checkResult({
      id: 'release-smoke-preflight-browser-executable',
      passed: result?.ok === true,
      evidence: `Chromium-compatible browser executable is available for managed UI smoke (${result?.source || 'unknown'}).`,
      failMessage:
        sanitizeErrorMessage(
          result?.evidence ||
            'Chromium-compatible browser executable is required for managed UI smoke. Set SDKWORK_VIDEO_CUT_CHROME_EXECUTABLE_PATH or --chrome-executable-path.',
        ),
    });
  } catch (error) {
    return checkResult({
      id: 'release-smoke-preflight-browser-executable',
      passed: false,
      evidence: '',
      failMessage: sanitizeErrorMessage(error),
    });
  }
}

async function checkLocalPorts({ bindHost, count, probes, timeoutMs }) {
  try {
    const result = await probes.localPorts({ bindHost, count, timeoutMs });
    return checkResult({
      id: 'release-smoke-preflight-local-ports',
      passed: result?.ok === true,
      evidence: `${count} loopback ports are allocatable on ${bindHost}.`,
      failMessage: sanitizeErrorMessage(result?.error || result?.evidence || `Unable to allocate ${count} loopback ports.`),
    });
  } catch (error) {
    return checkResult({
      id: 'release-smoke-preflight-local-ports',
      passed: false,
      evidence: '',
      failMessage: sanitizeErrorMessage(error),
    });
  }
}

async function checkWritableDirectories({ paths, probes, projectRoot }) {
  const results = [];
  for (const path of paths) {
    try {
      const result = await probes.writableDirectory({ path, projectRoot });
      results.push({ path, ok: result?.ok === true, error: result?.error || result?.evidence || '' });
    } catch (error) {
      results.push({ path, ok: false, error: sanitizeErrorMessage(error) });
    }
  }

  const failed = results.filter((result) => !result.ok);
  return checkResult({
    id: 'release-smoke-preflight-writable-directories',
    passed: failed.length === 0,
    evidence: `Writable release smoke directories verified: ${paths.join(', ')}.`,
    failMessage: `Release smoke directories are not writable: ${failed
      .map((result) => `${result.path} (${sanitizeErrorMessage(result.error)})`)
      .join(', ')}`,
  });
}

function probeCommand({ args, command, projectRoot, timeoutMs }) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error) {
    return {
      ok: false,
      error: sanitizeErrorMessage(result.error),
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: sanitizeErrorMessage(result.stderr || result.stdout || `exit ${result.status}`),
    };
  }

  return {
    ok: true,
    version: sanitizeErrorMessage(result.stdout || result.stderr || 'version unavailable'),
  };
}

function probeBrowserExecutable({ chromeExecutablePath }) {
  const candidates = chromeExecutablePath ? [chromeExecutablePath] : defaultChromeExecutableCandidates();
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    return {
      ok: false,
      evidence:
        'No Chromium-compatible browser executable was found. Set SDKWORK_VIDEO_CUT_CHROME_EXECUTABLE_PATH or --chrome-executable-path.',
    };
  }

  return {
    ok: true,
    source: chromeExecutablePath ? 'configured' : 'default-search',
  };
}

async function probeLocalPorts({ bindHost, count, timeoutMs }) {
  const servers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = await listenOnEphemeralPort(bindHost, timeoutMs);
      servers.push(server);
    }
    return { ok: true, count };
  } finally {
    await Promise.all(servers.map((server) => closeServer(server)));
  }
}

function probeWritableDirectory({ path, projectRoot }) {
  const absoluteDirectory = resolve(projectRoot, path);
  const probeFile = resolve(absoluteDirectory, `.release-smoke-preflight-${process.pid}-${Date.now()}.tmp`);
  mkdirSync(absoluteDirectory, { recursive: true });
  writeFileSync(probeFile, 'ok\n', 'utf8');
  unlinkSync(probeFile);
  return {
    ok: true,
  };
}

function listenOnEphemeralPort(bindHost, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    const timeout = setTimeout(() => {
      server.close();
      rejectPromise(new Error(`Timed out while allocating a local port on ${bindHost}.`));
    }, timeoutMs);

    server.once('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    server.listen(0, bindHost, () => {
      clearTimeout(timeout);
      resolvePromise(server);
    });
  });
}

function closeServer(server) {
  return new Promise((resolvePromise) => {
    server.close(() => resolvePromise());
  });
}

function defaultChromeExecutableCandidates() {
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
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

function summarizeChecks(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

function checkResult({ evidence, failMessage, id, passed }) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    evidence: passed ? evidence : failMessage,
  };
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printHumanReport(report) {
  const lines = [
    'SDKWork Video Cut Release Smoke Preflight',
    `environmentStatus: ${report.environmentStatus}`,
    `status: ${report.status}`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    `reportPath: ${report.reportPath}`,
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
    const options = parseReleaseSmokePreflightArgs(process.argv.slice(2));
    const report = await createReleaseSmokePreflightReport(options);
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
          environmentStatus: 'blocked',
          error: {
            code: 'RELEASE_SMOKE_PREFLIGHT_FAILED',
            message: sanitizeErrorMessage(error),
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
