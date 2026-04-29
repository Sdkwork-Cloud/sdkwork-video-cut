#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_HOST_URL = 'http://127.0.0.1:6177/api/video-cut/v1';
const REPORT_VERSION = 'video-cut.http-workflow-smoke.v1';
const API_ROUTE_PREFIX = '/api/video-cut/v1';

export function parseHttpWorkflowSmokeArgs(argv, env = process.env) {
  const args = [...argv];
  let profile = 'desktop-dev';
  let deploymentMode = 'desktop-local';
  let hostUrl = env.SDKWORK_VIDEO_CUT_HOST_URL || env.VITE_VIDEO_CUT_HOST_BASE_URL || DEFAULT_HOST_URL;
  let authToken = env.SDKWORK_VIDEO_CUT_SERVER_TOKEN || env.VITE_VIDEO_CUT_SERVER_TOKEN || '';
  let sourceFile = '';
  let fixtureDir = 'artifacts/smoke';
  let ffmpegPath = env.SDKWORK_VIDEO_CUT_FFMPEG_PATH || 'ffmpeg';
  let keepFixture = false;
  let json = false;
  let reportPath = '';
  let timeoutMs = 120_000;
  let title = 'HTTP workflow smoke';

  if (args[0] && !args[0].startsWith('-')) {
    profile = args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--keep-fixture') {
      keepFixture = true;
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

    if (arg === '--source-file') {
      sourceFile = requireValue(args, index, arg);
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

    if (arg === '--title') {
      title = requireValue(args, index, arg);
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

    throw new Error(`Unknown HTTP workflow smoke argument: ${arg}`);
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  return {
    authToken,
    deploymentMode,
    ffmpegPath,
    fixtureDir,
    hostUrl: normalizeHostUrl(hostUrl),
    json,
    keepFixture,
    profile,
    reportPath,
    sourceFile,
    timeoutMs,
    title,
  };
}

export async function createHttpWorkflowSmokeReport({
  authToken = '',
  deploymentMode = 'desktop-local',
  fetchImpl = fetch,
  fixtureBytes,
  fixtureDir = 'artifacts/smoke',
  ffmpegPath = 'ffmpeg',
  generatedAt = new Date().toISOString(),
  hostUrl = DEFAULT_HOST_URL,
  keepFixture = false,
  profile = 'desktop-dev',
  reportPath = '',
  sourceFile = '',
  timeoutMs = 120_000,
  title = 'HTTP workflow smoke',
} = {}) {
  const normalizedHostUrl = normalizeHostUrl(hostUrl);
  const checks = [];
  const source = prepareSourceFixture({
    ffmpegPath,
    fixtureBytes,
    fixtureDir,
    sourceFile,
  });

  try {
    const health = await requestEnvelope(fetchImpl, normalizedHostUrl, '/health', {
      authToken,
      timeoutMs,
    });
    addCheck(checks, 'health', health.status === 'ok' ? 'ok' : 'fail', 'Host health endpoint is reachable.', {
      status: health.status,
    });

    const task = await requestEnvelope(fetchImpl, normalizedHostUrl, '/tasks', {
      authToken,
      body: JSON.stringify({
        title,
        type: 'long-interview',
      }),
      method: 'POST',
      timeoutMs,
    });
    addCheck(checks, 'taskCreate', task.taskId ? 'ok' : 'fail', 'Task can be created through the HTTP API.', {
      taskId: task.taskId,
    });

    const uploadBody = new FormData();
    uploadBody.append('file', new Blob([source.bytes], { type: 'video/mp4' }), source.fileName);
    const sourceArtifact = await requestEnvelope(fetchImpl, normalizedHostUrl, `/tasks/${encodeURIComponent(task.taskId)}/source/file`, {
      authToken,
      body: uploadBody,
      method: 'POST',
      timeoutMs,
    });
    addCheck(checks, 'sourceUpload', sourceArtifact.kind === 'source' ? 'ok' : 'fail', 'Source media can be uploaded as multipart/form-data.', {
      artifactId: sourceArtifact.artifactId,
      sizeBytes: sourceArtifact.sizeBytes,
    });

    const analyzedTask = await requestEnvelope(fetchImpl, normalizedHostUrl, `/tasks/${encodeURIComponent(task.taskId)}/analyze`, {
      authToken,
      method: 'POST',
      timeoutMs,
    });
    addCheck(checks, 'analysis', analyzedTask.status === 'planReady' ? 'ok' : 'fail', 'Analysis pipeline produces a split plan.', {
      status: analyzedTask.status,
    });

    const plan = await requestEnvelope(fetchImpl, normalizedHostUrl, `/tasks/${encodeURIComponent(task.taskId)}/plan`, {
      authToken,
      timeoutMs,
    });
    const smokePlan = normalizeSmokePlan(plan);
    await requestEnvelope(fetchImpl, normalizedHostUrl, `/tasks/${encodeURIComponent(task.taskId)}/plan`, {
      authToken,
      body: JSON.stringify(smokePlan),
      method: 'PUT',
      timeoutMs,
    });
    addCheck(checks, 'planRoundtrip', 'ok', 'Split plan can be read, normalized for smoke duration, and persisted.', {
      segmentCount: Array.isArray(smokePlan.segments) ? smokePlan.segments.length : 0,
    });

    const renderedTask = await requestEnvelope(fetchImpl, normalizedHostUrl, `/tasks/${encodeURIComponent(task.taskId)}/render`, {
      authToken,
      method: 'POST',
      timeoutMs,
    });
    addCheck(checks, 'render', renderedTask.status === 'succeeded' ? 'ok' : 'fail', 'FFmpeg render completes through the HTTP API.', {
      status: renderedTask.status,
    });

    const artifacts = await requestEnvelope(fetchImpl, normalizedHostUrl, `/tasks/${encodeURIComponent(task.taskId)}/artifacts`, {
      authToken,
      timeoutMs,
    });
    const outputArtifact = findRequiredArtifact(artifacts, 'render');
    const manifestArtifact = findRequiredArtifact(artifacts, 'render-manifest');
    const logArtifact = findRequiredArtifact(artifacts, 'log');
    addCheck(checks, 'artifactList', 'ok', 'Render, manifest, and log artifacts are listed.', {
      artifactCount: artifacts.length,
    });

    const [outputDownload, manifestDownload, logDownload] = await Promise.all([
      requestEnvelope(fetchImpl, normalizedHostUrl, artifactPath(task.taskId, outputArtifact.artifactId, '/download'), {
        authToken,
        timeoutMs,
      }),
      requestEnvelope(fetchImpl, normalizedHostUrl, artifactPath(task.taskId, manifestArtifact.artifactId, '/download'), {
        authToken,
        timeoutMs,
      }),
      requestEnvelope(fetchImpl, normalizedHostUrl, artifactPath(task.taskId, logArtifact.artifactId, '/download'), {
        authToken,
        timeoutMs,
      }),
    ]);
    addCheck(checks, 'artifactDownloadDescriptors', 'ok', 'Artifact download descriptors use host content endpoints.', {
      outputMode: outputDownload.downloadMode,
      manifestMode: manifestDownload.downloadMode,
      logMode: logDownload.downloadMode,
    });

    const outputDownloadResult = await requestBinary(fetchImpl, normalizedHostUrl, descriptorContentPath(outputDownload, normalizedHostUrl), {
      authToken,
      timeoutMs,
    });
    const outputBytes = outputDownloadResult.bytes;
    const outputRangeDownload = await requestBinaryRange(fetchImpl, normalizedHostUrl, descriptorContentPath(outputDownload, normalizedHostUrl), {
      authToken,
      range: 'bytes=0-11',
      timeoutMs,
    });
    const manifestText = await requestText(fetchImpl, normalizedHostUrl, descriptorContentPath(manifestDownload, normalizedHostUrl), {
      authToken,
      timeoutMs,
    });
    const logText = await requestText(fetchImpl, normalizedHostUrl, descriptorContentPath(logDownload, normalizedHostUrl), {
      authToken,
      timeoutMs,
    });
    const manifest = parseJson(manifestText, 'render manifest');
    const artifactContentStatus =
      outputBytes.byteLength > 0 && isLikelyMp4(outputBytes) && isRenderManifest(manifest) && logText.includes('video-cut.render-log.schema.v1')
        ? 'ok'
        : 'fail';
    addCheck(checks, 'artifactContent', artifactContentStatus, 'Rendered MP4, render manifest, and render log can be downloaded.', {
      manifestSchemaId: manifest.schemaId,
      outputBytes: outputBytes.byteLength,
    });
    const artifactRangeStatus =
      outputRangeDownload.bytes.byteLength > 0 &&
      outputRangeDownload.status === 206 &&
      outputRangeDownload.acceptRanges === 'bytes' &&
      outputRangeDownload.contentRange.startsWith('bytes 0-')
        ? 'ok'
        : 'fail';
    const securityHeadersStatus =
      hasPrivateArtifactSecurityHeaders(outputDownloadResult.headers) && hasPrivateArtifactSecurityHeaders(outputRangeDownload.headers)
        ? 'ok'
        : 'fail';
    addCheck(checks, 'artifactRangeContent', artifactRangeStatus, 'Rendered MP4 supports byte range delivery for browser playback.', {
      acceptRanges: outputRangeDownload.acceptRanges,
      contentRange: outputRangeDownload.contentRange,
      outputRangeBytes: outputRangeDownload.bytes.byteLength,
    });
    addCheck(checks, 'artifactSecurityHeaders', securityHeadersStatus, 'Artifact content responses use private no-store and nosniff headers.', {
      cacheControl: outputDownloadResult.headers.cacheControl,
      pragma: outputDownloadResult.headers.pragma,
      rangeCacheControl: outputRangeDownload.headers.cacheControl,
      rangePragma: outputRangeDownload.headers.pragma,
      rangeXContentTypeOptions: outputRangeDownload.headers.xContentTypeOptions,
      xContentTypeOptions: outputDownloadResult.headers.xContentTypeOptions,
    });

    const events = await requestEnvelope(fetchImpl, normalizedHostUrl, `/tasks/${encodeURIComponent(task.taskId)}/events`, {
      authToken,
      timeoutMs,
    });
    addCheck(checks, 'events', Array.isArray(events) && events.length > 0 ? 'ok' : 'fail', 'Workflow emits task progress events.', {
      eventCount: Array.isArray(events) ? events.length : 0,
    });

    const reportDraft = {
      artifacts: {
        log: summarizeArtifact(logArtifact, logDownload),
        manifest: summarizeArtifact(manifestArtifact, manifestDownload),
        output: {
          ...summarizeArtifact(outputArtifact, outputDownload),
          bytesChecked: outputBytes.byteLength,
          mp4Signature: isLikelyMp4(outputBytes),
          rangeBytesChecked: outputRangeDownload.bytes.byteLength,
          rangeChecked: artifactRangeStatus === 'ok',
          securityHeadersChecked: securityHeadersStatus === 'ok',
        },
      },
      deploymentMode,
      generatedAt,
      hostUrl: normalizedHostUrl,
      ok: false,
      profile,
      reportVersion: REPORT_VERSION,
      source: {
        fileName: source.fileName,
        generated: source.generated,
        sizeBytes: source.bytes.byteLength,
      },
      taskId: task.taskId,
    };
    const redactionStatus = reportContainsSensitiveData(reportDraft, authToken) ? 'fail' : 'ok';
    addCheck(checks, 'redaction', redactionStatus, 'Smoke report does not include secrets, auth headers, or local source paths.');

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
    if (source.generated && !keepFixture && source.fixturePath) {
      rmSync(source.fixturePath, { force: true });
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
  return String(value || DEFAULT_HOST_URL).replace(/\/+$/, '');
}

function authHeaders(authToken) {
  const token = String(authToken || '').trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function requestEnvelope(fetchImpl, hostUrl, path, { authToken = '', body, method = 'GET', timeoutMs = 120_000 } = {}) {
  const response = await request(fetchImpl, hostUrl, path, {
    authToken,
    body,
    method,
    timeoutMs,
    accept: 'application/json',
  });
  const raw = await response.text();
  const envelope = parseJson(raw, `HTTP ${method} ${path}`);
  if (!response.ok || envelope?.ok !== true) {
    const code = envelope?.error?.code || `HTTP_${response.status}`;
    const message = envelope?.error?.message || `Video cut host request failed: ${method} ${path}`;
    throw new Error(`${code}: ${message}`);
  }

  return envelope.data;
}

async function requestText(fetchImpl, hostUrl, path, { authToken = '', timeoutMs = 120_000 } = {}) {
  const response = await request(fetchImpl, hostUrl, path, {
    authToken,
    method: 'GET',
    timeoutMs,
    accept: 'text/plain, application/json;q=0.9, */*;q=0.8',
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP_${response.status}: unable to download text artifact ${path}`);
  }

  return text;
}

async function requestBinary(fetchImpl, hostUrl, path, { authToken = '', timeoutMs = 120_000 } = {}) {
  const response = await request(fetchImpl, hostUrl, path, {
    authToken,
    method: 'GET',
    timeoutMs,
    accept: '*/*',
  });
  if (!response.ok) {
    throw new Error(`HTTP_${response.status}: unable to download binary artifact ${path}`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    headers: responseSecurityHeaders(response),
  };
}

async function requestBinaryRange(fetchImpl, hostUrl, path, { authToken = '', range, timeoutMs = 120_000 } = {}) {
  const response = await request(fetchImpl, hostUrl, path, {
    authToken,
    method: 'GET',
    timeoutMs,
    accept: '*/*',
    headers: {
      range,
    },
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (response.status !== 206) {
    throw new Error(`HTTP_${response.status}: unable to download binary artifact range ${path}`);
  }

  return {
    acceptRanges: response.headers.get('accept-ranges') || '',
    bytes,
    contentRange: response.headers.get('content-range') || '',
    headers: responseSecurityHeaders(response),
    status: response.status,
  };
}

function responseSecurityHeaders(response) {
  return {
    cacheControl: response.headers.get('cache-control') || '',
    pragma: response.headers.get('pragma') || '',
    xContentTypeOptions: response.headers.get('x-content-type-options') || '',
  };
}

function hasPrivateArtifactSecurityHeaders(headers) {
  return headers?.cacheControl === 'private, no-store' && headers?.pragma === 'no-cache' && headers?.xContentTypeOptions === 'nosniff';
}

async function request(fetchImpl, hostUrl, path, { accept, authToken, body, headers = {}, method, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const isFormDataBody = typeof FormData !== 'undefined' && body instanceof FormData;

  try {
    return await fetchImpl(`${hostUrl}${path}`, {
      body,
      headers: {
        accept,
        ...authHeaders(authToken),
        ...headers,
        ...(body && !isFormDataBody ? { 'content-type': 'application/json' } : {}),
      },
      method,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function prepareSourceFixture({ ffmpegPath, fixtureBytes, fixtureDir, sourceFile }) {
  if (sourceFile) {
    const sourcePath = resolve(sourceFile);
    if (!existsSync(sourcePath)) {
      throw new Error(`Source file does not exist: ${sourceFile}`);
    }

    return {
      bytes: readFileSync(sourcePath),
      fileName: basename(sourcePath),
      fixturePath: '',
      generated: false,
    };
  }

  if (fixtureBytes) {
    return {
      bytes: fixtureBytes,
      fileName: 'smoke-source.mp4',
      fixturePath: '',
      generated: false,
    };
  }

  const fixtureRoot = resolve(fixtureDir);
  mkdirSync(fixtureRoot, { recursive: true });
  const fixturePath = resolve(fixtureRoot, `http-workflow-smoke-source-${Date.now()}.mp4`);
  execFileSync(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=30',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=16000:cl=mono',
      '-t',
      '3',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      fixturePath,
    ],
    { stdio: 'pipe' },
  );

  return {
    bytes: readFileSync(fixturePath),
    fileName: basename(fixturePath),
    fixturePath,
    generated: true,
  };
}

function normalizeSmokePlan(plan) {
  if (!plan || !Array.isArray(plan.segments) || plan.segments.length === 0) {
    throw new Error('Split plan must contain at least one segment for HTTP workflow smoke.');
  }

  const nextPlan = structuredClone(plan);
  const firstSegment = nextPlan.segments[0];
  const rawEndMs = Number(firstSegment?.sourceRange?.endMs || firstSegment?.outputRange?.endMs || 1800);
  const endMs = Number.isFinite(rawEndMs) && rawEndMs > 900 ? Math.min(rawEndMs, 1800) : 1000;
  const startMs = endMs > 1000 ? 500 : 0;
  firstSegment.sourceRange = {
    ...(firstSegment.sourceRange || {}),
    endMs,
    startMs,
  };
  firstSegment.outputRange = {
    ...(firstSegment.outputRange || {}),
    endMs: endMs - startMs,
    startMs: 0,
  };

  return nextPlan;
}

function findRequiredArtifact(artifacts, kind) {
  if (!Array.isArray(artifacts)) {
    throw new Error('Artifact list response must be an array.');
  }

  const artifact = artifacts.find((item) => item.kind === kind);
  if (!artifact) {
    throw new Error(`Expected artifact kind is missing: ${kind}`);
  }

  return artifact;
}

function artifactPath(taskId, artifactId, suffix) {
  return `/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}${suffix}`;
}

function descriptorContentPath(descriptor, hostUrl) {
  const rawUrl = String(descriptor.url || '');
  if (!rawUrl) {
    throw new Error(`Artifact descriptor ${descriptor.artifactId} does not include a content URL.`);
  }

  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    const path = new URL(rawUrl).pathname;
    return stripApiRoutePrefix(path, hostUrl);
  }

  return stripApiRoutePrefix(rawUrl, hostUrl);
}

function stripApiRoutePrefix(path, hostUrl) {
  const hostPath = new URL(hostUrl).pathname.replace(/\/+$/, '');
  if (hostPath && path.startsWith(`${hostPath}/`)) {
    return path.slice(hostPath.length);
  }

  if (path.startsWith(`${API_ROUTE_PREFIX}/`)) {
    return path.slice(API_ROUTE_PREFIX.length);
  }

  return path;
}

function summarizeArtifact(artifact, descriptor) {
  return {
    artifactId: artifact.artifactId,
    contentType: descriptor.contentType,
    downloadMode: descriptor.downloadMode,
    kind: artifact.kind,
    path: artifact.path,
    sizeBytes: artifact.sizeBytes,
  };
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isLikelyMp4(bytes) {
  if (!bytes || bytes.byteLength < 8) {
    return false;
  }

  const probeLength = Math.min(bytes.byteLength - 3, 64);
  for (let index = 0; index < probeLength; index += 1) {
    if (bytes[index] === 0x66 && bytes[index + 1] === 0x74 && bytes[index + 2] === 0x79 && bytes[index + 3] === 0x70) {
      return true;
    }
  }

  return false;
}

function isRenderManifest(manifest) {
  return typeof manifest?.schemaId === 'string' && manifest.schemaId.startsWith('video-cut.render');
}

function addCheck(checks, checkId, status, label, details = {}) {
  checks.push({
    checkId,
    details,
    label,
    status: status === 'fail' || status === 'warn' ? status : 'ok',
  });
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

function reportContainsSensitiveData(report, authToken) {
  const serialized = JSON.stringify(report);
  const token = String(authToken || '').trim();
  return Boolean(
    (token && serialized.includes(token)) ||
      serialized.includes('"authorization"') ||
      serialized.includes('"apiKey"') ||
      /\bsk-[A-Za-z0-9_-]{8,}/.test(serialized),
  );
}

function redactReport(report) {
  return JSON.parse(
    JSON.stringify(report, (key, value) => {
      if (key === 'apiKey' || key === 'token' || key === 'serverToken' || key === 'authToken' || key === 'authorization') {
        return undefined;
      }

      return value;
    }),
  );
}

function printHumanReport(report) {
  const lines = [
    'SDKWork Video Cut HTTP Workflow Smoke',
    `profile: ${report.profile}`,
    `deploymentMode: ${report.deploymentMode}`,
    `hostUrl: ${report.hostUrl}`,
    `taskId: ${report.taskId}`,
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
    const options = parseHttpWorkflowSmokeArgs(process.argv.slice(2));
    const report = await createHttpWorkflowSmokeReport(options);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report);
    }

    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const failure = {
      error: {
        code: 'HTTP_WORKFLOW_SMOKE_FAILED',
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
