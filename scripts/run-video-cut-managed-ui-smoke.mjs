#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createBrowserChildProcessEnv } from './lib/safe-env.mjs';
import { normalizeCliArgs } from './lib/cli-args.mjs';
import { redactReport, reportContainsSensitiveData } from './lib/report-safety.mjs';

const REPORT_VERSION = 'video-cut.managed-ui-workflow-smoke.v1';
const API_ROUTE_PREFIX = '/api/video-cut/v1';

export function parseManagedUiSmokeArgs(argv, env = process.env) {
  const args = normalizeCliArgs(argv);
  let profile = 'server-dev';
  let deploymentMode = 'server-private';
  let bindHost = '127.0.0.1';
  let hostPort = Number(env.SDKWORK_VIDEO_CUT_PORT || 0);
  let webPort = Number(env.SDKWORK_VIDEO_CUT_WEB_PORT || 0);
  let hostUrl = '';
  let webUrl = '';
  let authToken = env.SDKWORK_VIDEO_CUT_SERVER_TOKEN || '';
  let workspaceRoot = '';
  let sourceFile = '';
  let fixtureDir = 'artifacts/smoke';
  let ffmpegPath = env.SDKWORK_VIDEO_CUT_FFMPEG_PATH || 'ffmpeg';
  let chromeExecutablePath = env.SDKWORK_VIDEO_CUT_CHROME_EXECUTABLE_PATH || findDefaultChromeExecutable();
  let keepWorkspace = false;
  let keepFixture = false;
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

    if (arg === '--keep-fixture') {
      keepFixture = true;
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

    if (arg === '--host-port') {
      hostPort = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--web-port') {
      webPort = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--host-url') {
      hostUrl = normalizeUrl(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--web-url') {
      webUrl = normalizeUrl(requireValue(args, index, arg));
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

    if (arg === '--chrome-executable-path') {
      chromeExecutablePath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--timeout-ms') {
      timeoutMs = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--report-path') {
      reportPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown managed UI smoke argument: ${arg}`);
  }

  assertPort('host-port', hostPort);
  assertPort('web-port', webPort);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  if (!hostUrl && hostPort > 0) {
    hostUrl = `http://${bindHost}:${hostPort}${API_ROUTE_PREFIX}`;
  }
  if (!webUrl && webPort > 0) {
    webUrl = `http://${bindHost}:${webPort}`;
  }

  return {
    authToken,
    bindHost,
    chromeExecutablePath,
    deploymentMode,
    ffmpegPath,
    fixtureDir,
    hostPort,
    hostUrl,
    json,
    keepFixture,
    keepWorkspace,
    profile,
    reportPath,
    sourceFile,
    timeoutMs,
    webPort,
    webUrl,
    workspaceRoot,
  };
}

export async function createManagedUiWorkflowSmokeReport({
  authToken = '',
  bindHost = '127.0.0.1',
  browserWorkflowImpl = runBrowserUiWorkflow,
  chromeExecutablePath = findDefaultChromeExecutable(),
  deploymentMode = 'server-private',
  execFileSyncImpl = execFileSync,
  fetchImpl = fetch,
  fixtureDir = 'artifacts/smoke',
  ffmpegPath = 'ffmpeg',
  generatedAt = new Date().toISOString(),
  hostPort = 0,
  hostUrl = '',
  keepFixture = false,
  keepWorkspace = false,
  portAllocator = allocateLocalPort,
  profile = 'server-dev',
  projectRoot = process.cwd(),
  reportPath = '',
  sourceFile = '',
  spawnImpl = spawn,
  timeoutMs = 120_000,
  tokenFactory = () => `managed-ui-${randomUUID()}`,
  webPort = 0,
  webUrl = '',
  workspaceRoot = '',
} = {}) {
  const checks = [];
  const resolvedHostPort = hostPort > 0 ? hostPort : await portAllocator();
  const resolvedWebPort = webPort > 0 ? webPort : await portAllocator();
  const resolvedHostUrl = normalizeUrl(hostUrl || `http://${bindHost}:${resolvedHostPort}${API_ROUTE_PREFIX}`);
  const resolvedWebUrl = normalizeUrl(webUrl || `http://${bindHost}:${resolvedWebPort}`);
  const serverToken = authToken || tokenFactory();
  const workspaceWasGenerated = !workspaceRoot;
  const resolvedWorkspaceRoot = resolve(
    projectRoot,
    workspaceRoot || `artifacts/runtime/managed-ui-smoke-workspace-${resolvedHostPort}-${Date.now()}`,
  );
  const logPrefix = resolve(projectRoot, `artifacts/runtime/managed-ui-smoke-${resolvedHostPort}-${resolvedWebPort}`);
  const hostBinaryPath = resolve(projectRoot, 'host', 'target', 'debug', hostBinaryName());
  const viteBinPath = resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  let hostChild;
  let webChild;
  let fixture;

  try {
    mkdirSync(resolvedWorkspaceRoot, { recursive: true });
    mkdirSync(dirname(logPrefix), { recursive: true });
    execFileSyncImpl('cargo', ['build', '--manifest-path', 'host/Cargo.toml', '--bin', 'sdkwork-video-cut-host'], {
      cwd: projectRoot,
      stdio: 'pipe',
    });
    addCheck(checks, 'hostBuild', 'ok', 'Rust Host binary builds before managed UI smoke.', {
      binary: 'host/target/debug/sdkwork-video-cut-host',
    });

    hostChild = spawnImpl(hostBinaryPath, [], {
      cwd: projectRoot,
      env: {
        ...process.env,
        SDKWORK_VIDEO_CUT_AUTH_MODE: 'single-user-token',
        SDKWORK_VIDEO_CUT_BIND_HOST: bindHost,
        SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS: resolvedWebUrl,
        SDKWORK_VIDEO_CUT_PORT: String(resolvedHostPort),
        SDKWORK_VIDEO_CUT_PUBLIC_BASE_URL: `http://${bindHost}:${resolvedHostPort}`,
        SDKWORK_VIDEO_CUT_RUNTIME_MODE: deploymentMode,
        SDKWORK_VIDEO_CUT_SERVER_TOKEN: serverToken,
        SDKWORK_VIDEO_CUT_WORKSPACE_ROOT: resolvedWorkspaceRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    attachProcessLogs(hostChild, `${logPrefix}.host.out.log`, `${logPrefix}.host.err.log`);
    addCheck(checks, 'hostStart', hostChild?.pid ? 'ok' : 'fail', 'Managed server-private Host process starts for UI smoke.', {
      pid: hostChild?.pid ?? null,
    });

    await waitForJsonHealth(fetchImpl, `${resolvedHostUrl}/health`, timeoutMs);
    addCheck(checks, 'hostHealth', 'ok', 'Managed Host health endpoint is reachable for UI smoke.');

    webChild = spawnImpl(process.execPath, [viteBinPath, '--host', bindHost, '--port', String(resolvedWebPort), '--strictPort'], {
      cwd: projectRoot,
      env: createBrowserChildProcessEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    attachProcessLogs(webChild, `${logPrefix}.web.out.log`, `${logPrefix}.web.err.log`);
    addCheck(checks, 'webStart', webChild?.pid ? 'ok' : 'fail', 'Managed Vite web process starts for UI smoke.', {
      pid: webChild?.pid ?? null,
    });

    await waitForWeb(fetchImpl, resolvedWebUrl, timeoutMs);
    addCheck(checks, 'webHealth', 'ok', 'Managed Vite web endpoint is reachable for browser UI smoke.');

    fixture = prepareUiSmokeSourceFile({
      execFileSyncImpl,
      ffmpegPath,
      fixtureDir,
      projectRoot,
      sourceFile,
    });
    const browserWorkflow = await browserWorkflowImpl({
      authToken: serverToken,
      chromeExecutablePath,
      hostUrl: resolvedHostUrl,
      sourceFilePath: fixture.path,
      timeoutMs,
      webUrl: resolvedWebUrl,
    });
    addCheck(
      checks,
      'browserWorkflow',
      isManagedUiBrowserWorkflowOk(browserWorkflow) ? 'ok' : 'fail',
      'Browser UI can upload, analyze, render, open Results, and verify the delivery package.',
      {
        deliveryIntegrityStatus: browserWorkflow?.deliveryIntegrityStatus,
        statusText: browserWorkflow?.statusText,
        taskTitle: browserWorkflow?.taskTitle,
      },
    );

    const cleanupStatus = cleanupProcess(webChild) && cleanupProcess(hostChild);
    webChild = undefined;
    hostChild = undefined;
    addCheck(checks, 'processCleanup', cleanupStatus ? 'ok' : 'warn', 'Managed UI smoke Host and web process cleanup completed.');

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
        hostPort: resolvedHostPort,
        webPort: resolvedWebPort,
        workspaceRoot: workspaceWasGenerated ? '<generated-workspace>' : resolvedWorkspaceRoot,
      },
      ui: {
        artifactContentAuthorizationVerified: browserWorkflow?.artifactContentAuthorizationVerified === true,
        artifactContentEndpointFetched: browserWorkflow?.artifactContentEndpointFetched === true,
        artifactDownloadAuthorizationVerified: browserWorkflow?.artifactDownloadAuthorizationVerified === true,
        artifactDownloadButtonVisible: browserWorkflow?.artifactDownloadButtonVisible === true,
        artifactDownloadContentFetched: browserWorkflow?.artifactDownloadContentFetched === true,
        browser: chromeExecutablePath ? 'chromium-compatible' : 'unconfigured',
        deliveryIntegrityStatus: browserWorkflow?.deliveryIntegrityStatus ?? 'unknown',
        deliveryPackageVisible: browserWorkflow?.deliveryPackageVisible === true,
        diagnosticsBundleVerified: browserWorkflow?.diagnosticsBundleVerified === true,
        doctorVerified: browserWorkflow?.doctorVerified === true,
        localPathLeakVisible: browserWorkflow?.localPathLeakVisible === true,
        manifestVisible: browserWorkflow?.manifestVisible === true,
        outputArtifactVisible: browserWorkflow?.outputArtifactVisible === true,
        outputPreviewBlobUrl: browserWorkflow?.outputPreviewBlobUrl === true,
        providerConformanceVerified: browserWorkflow?.providerConformanceVerified === true,
        resultsPageVerified: browserWorkflow?.resultsPageVerified === true,
        settingsRedactionVerified: browserWorkflow?.settingsRedactionVerified === true,
        settingsSaved: browserWorkflow?.settingsSaved === true,
        statusText: browserWorkflow?.statusText,
        taskTitle: browserWorkflow?.taskTitle,
      },
      webUrl: resolvedWebUrl,
    };
    const redactionStatus = reportContainsSensitiveData(reportDraft, serverToken) ? 'fail' : 'ok';
    addCheck(checks, 'redaction', redactionStatus, 'Managed UI smoke report does not include secrets or raw environment values.');

    const summary = summarizeChecks(checks);
    const report = redactReport({
      ...reportDraft,
      checks,
      ok: summary.fail === 0,
      summary,
    }, [serverToken]);
    writeReportIfRequested(reportPath, report);
    return report;
  } finally {
    if (webChild) {
      cleanupProcess(webChild);
    }
    if (hostChild) {
      cleanupProcess(hostChild);
    }
    if (fixture?.generated && !keepFixture) {
      rmSync(fixture.path, { force: true });
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

async function runBrowserUiWorkflow({
  authToken = '',
  chromeExecutablePath,
  hostUrl,
  sourceFilePath,
  timeoutMs = 120_000,
  webUrl,
}) {
  if (!chromeExecutablePath || !existsSync(chromeExecutablePath)) {
    throw new Error('Chrome executable is required for managed UI smoke. Use --chrome-executable-path or SDKWORK_VIDEO_CUT_CHROME_EXECUTABLE_PATH.');
  }

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    args: ['--no-sandbox'],
    executablePath: chromeExecutablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(
      ({ hostBaseUrl, token }) => {
        window.__SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__ = {
          authToken: token || undefined,
          hostBaseUrl,
          hostMode: 'http',
        };
      },
      { hostBaseUrl: hostUrl, token: authToken },
    );
    const artifactContentRequests = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!isHostArtifactContentUrl(url, hostUrl)) {
        return;
      }

      const authorization = request.headers().authorization || '';
      artifactContentRequests.push({
        authorized: /^Bearer\s+\S+/i.test(authorization),
      });
    });
    page.setDefaultTimeout(timeoutMs);
    await page.goto(webUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
    await page.locator('[aria-label="Capability summary"]').waitFor({ timeout: timeoutMs });

    const taskCreateResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`${API_ROUTE_PREFIX}/tasks`),
      { timeout: timeoutMs },
    );
    const sourceUploadResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/source/file'),
      { timeout: timeoutMs },
    );
    await page.locator('input[aria-label="导入本地视频"]').setInputFiles(sourceFilePath);
    await readOkEnvelope(await taskCreateResponsePromise, 'Create task through Workbench upload');
    await readOkEnvelope(await sourceUploadResponsePromise, 'Upload source through Workbench upload');
    await page.getByText('sourceReady').waitFor({ timeout: timeoutMs });

    await page.getByRole('button', { name: 'Analyze selected task' }).click();
    await page.getByText('planReady').waitFor({ timeout: timeoutMs });
    await page.getByText('Transcript, semantic analysis, and split plan generated.').waitFor({ timeout: timeoutMs });

    await page.getByRole('button', { name: 'Render selected task' }).click();
    await page.getByText('succeeded').waitFor({ timeout: timeoutMs });
    await page.getByText(/output\.mp4/).waitFor({ timeout: timeoutMs });
    await page.getByText('Rendered MP4, subtitles, cover, and render log.').waitFor({ timeout: timeoutMs });

    await page.locator('[data-page-id="results"]').click();
    await page.getByRole('region', { name: 'Render output preview' }).waitFor({ timeout: timeoutMs });
    const deliveryPackage = page.getByRole('region', { name: 'Delivery package' });
    await deliveryPackage.waitFor({ timeout: timeoutMs });
    await deliveryPackage.getByText('Render manifest', { exact: true }).waitFor({ timeout: timeoutMs });
    await deliveryPackage.getByText(/hashes present/).waitFor({ timeout: timeoutMs });

    const deliveryStatusText = (await deliveryPackage.locator('.delivery-status').first().innerText({ timeout: timeoutMs }))
      .trim()
      .replace(/\s+/g, ' ');
    const videoPreview = page.getByLabel('Rendered video preview');
    await videoPreview.waitFor({ timeout: timeoutMs });
    await page.waitForFunction(
      () => document.querySelector('video[aria-label="Rendered video preview"]')?.getAttribute('src')?.startsWith('blob:') === true,
      undefined,
      { timeout: timeoutMs },
    );
    const outputVideoUrl = (await videoPreview.getAttribute('src')) || '';
    const outputDownloadButton = page.getByRole('button', { name: /Download output\.mp4/ }).first();
    await outputDownloadButton.waitFor({ timeout: timeoutMs });
    const beforeDownloadRequestCount = artifactContentRequests.length;
    await outputDownloadButton.click();
    await waitForCondition(
      () => artifactContentRequests.length > beforeDownloadRequestCount,
      timeoutMs,
      'Artifact download button did not fetch artifact content.',
    );
    const artifactDownloadRequests = artifactContentRequests.slice(beforeDownloadRequestCount);
    const artifactContentEndpointFetched = artifactContentRequests.length > 0;
    const artifactContentAuthorizationVerified =
      artifactContentEndpointFetched && artifactContentRequests.every((request) => request.authorized === true);
    const artifactDownloadContentFetched = artifactDownloadRequests.length > 0;
    const artifactDownloadAuthorizationVerified =
      artifactDownloadContentFetched && artifactDownloadRequests.every((request) => request.authorized === true);
    const outputPreviewBlobUrl = outputVideoUrl.startsWith('blob:');
    const pageText = await page.locator('body').innerText({ timeout: timeoutMs });
    const localPathLeakVisible =
      containsServerLocalPath(pageText) ||
      containsServerLocalPath(outputVideoUrl);
    const settingsWorkflow = await runSettingsCenterWorkflow(page, timeoutMs);

    return {
      artifactContentAuthorizationVerified,
      artifactContentEndpointFetched,
      artifactDownloadAuthorizationVerified,
      artifactDownloadButtonVisible: true,
      artifactDownloadContentFetched,
      deliveryIntegrityStatus: deliveryStatusText,
      deliveryPackageVisible: true,
      diagnosticsBundleVerified: settingsWorkflow.diagnosticsBundleVerified,
      doctorVerified: settingsWorkflow.doctorVerified,
      localPathLeakVisible,
      manifestVisible: true,
      outputArtifactVisible: true,
      outputPreviewBlobUrl,
      providerConformanceVerified: settingsWorkflow.providerConformanceVerified,
      resultsPageVerified:
        artifactContentEndpointFetched &&
        artifactContentAuthorizationVerified &&
        artifactDownloadContentFetched &&
        artifactDownloadAuthorizationVerified &&
        outputPreviewBlobUrl &&
        !localPathLeakVisible,
      settingsRedactionVerified: settingsWorkflow.settingsRedactionVerified,
      settingsSaved: settingsWorkflow.settingsSaved,
      statusText: 'succeeded',
      taskTitle: basename(sourceFilePath, '.mp4'),
    };
  } finally {
    await browser.close();
  }
}

async function runSettingsCenterWorkflow(page, timeoutMs) {
  const aiSecret = 'sk-managed-ui-ai-secret';
  const sttSecret = 'sk-managed-ui-stt-secret';

  await page.locator('[data-page-id="settings"]').click();
  await page.getByRole('heading', { name: 'AI Providers' }).waitFor({ timeout: timeoutMs });
  const aiEnabled = page.getByLabel('Enable AI provider');
  if (!(await aiEnabled.isChecked())) {
    await aiEnabled.click();
  }
  await page.getByLabel('API key', { exact: true }).fill(aiSecret);

  await page.getByRole('button', { name: 'Speech To Text' }).click();
  await page.getByRole('heading', { name: 'Speech To Text' }).waitFor({ timeout: timeoutMs });
  const sttEnabled = page.getByLabel('Enable STT provider');
  if (!(await sttEnabled.isChecked())) {
    await sttEnabled.click();
  }
  const reuseAiProvider = page.getByLabel('Reuse AI provider');
  if (await reuseAiProvider.isChecked()) {
    await reuseAiProvider.click();
  }
  await page.getByLabel('API key', { exact: true }).fill(sttSecret);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByText('Settings saved').waitFor({ timeout: timeoutMs });
  const sttSecretInputCleared = (await page.getByLabel('API key', { exact: true }).inputValue()) === '';

  await page.getByRole('button', { name: 'AI Providers' }).click();
  await page.getByRole('button', { name: /Test structured output/ }).click();
  await page.getByText('video-cut.provider-conformance.v1').waitFor({ timeout: timeoutMs });
  await page.getByText('LLM structured output request contract').waitFor({ timeout: timeoutMs });

  await page.getByRole('button', { name: 'Speech To Text' }).click();
  await page.getByRole('button', { name: /Test transcription/ }).click();
  await page.getByText('runtime-speech-to-text-bridge').waitFor({ timeout: timeoutMs });
  await page.getByText('Speech-to-text provider bridge contract').waitFor({ timeout: timeoutMs });

  await page.getByRole('button', { name: 'Diagnostics' }).click();
  await page.getByRole('button', { name: /Run doctor/ }).click();
  await page.getByText('video-cut.doctor.v1').waitFor({ timeout: timeoutMs });
  await page.getByText('Runtime settings valid').waitFor({ timeout: timeoutMs });
  await page.getByRole('button', { name: /Export diagnostics/ }).click();
  await page.getByText('video-cut.diagnostics-bundle.v1').waitFor({ timeout: timeoutMs });
  await page.getByText(/redaction verified/i).waitFor({ timeout: timeoutMs });
  const diagnosticsHref = (await page.getByRole('link', { name: 'Download diagnostics JSON' }).getAttribute('href')) || '';
  const settingsPageText = await page.locator('body').innerText({ timeout: timeoutMs });
  const settingsRedactionVerified =
    sttSecretInputCleared &&
    !reportContainsSensitiveData({ diagnosticsHref, settingsPageText }, aiSecret) &&
    !reportContainsSensitiveData({ diagnosticsHref, settingsPageText }, sttSecret);

  return {
    diagnosticsBundleVerified: true,
    doctorVerified: true,
    providerConformanceVerified: true,
    settingsRedactionVerified,
    settingsSaved: true,
  };
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

async function readOkEnvelope(response, label) {
  const raw = await response.text();
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} returned non-JSON HTTP ${response.status()}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok() || envelope?.ok !== true) {
    const code = envelope?.error?.code || `HTTP_${response.status()}`;
    const message = envelope?.error?.message || `${label} failed.`;
    throw new Error(`${label} failed with ${code}: ${message}`);
  }

  return envelope.data;
}

function assertPort(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 65535) {
    throw new Error(`--${name} must be between 0 and 65535.`);
  }
}

function normalizeUrl(value) {
  return String(value || '').replace(/\/+$/, '');
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

async function waitForJsonHealth(fetchImpl, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, { headers: { accept: 'application/json' }, method: 'GET' });
      const body = await response.json();
      if (response.ok && body?.ok === true && body?.data?.status === 'ok') {
        return;
      }
      lastError = new Error(`Health returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(`JSON health endpoint was not ready within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForWeb(fetchImpl, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, { headers: { accept: 'text/html' }, method: 'GET' });
      const text = await response.text();
      if (response.ok && text.includes('sdkwork-video-cut')) {
        return;
      }
      lastError = new Error(`Web returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(`Web endpoint was not ready within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitForCondition(predicate, timeoutMs, timeoutMessage) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(100);
  }

  throw new Error(`${timeoutMessage} Timeout ${timeoutMs}ms.`);
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

function prepareUiSmokeSourceFile({ execFileSyncImpl = execFileSync, ffmpegPath, fixtureDir, projectRoot, sourceFile }) {
  if (sourceFile) {
    const sourcePath = resolve(projectRoot, sourceFile);
    if (!existsSync(sourcePath)) {
      throw new Error(`Source file does not exist: ${sourceFile}`);
    }

    return {
      generated: false,
      path: sourcePath,
    };
  }

  const fixtureRoot = resolve(projectRoot, fixtureDir);
  mkdirSync(fixtureRoot, { recursive: true });
  const fixturePath = resolve(fixtureRoot, `managed-ui-smoke-source-${Date.now()}.mp4`);
  execFileSyncImpl(
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
    generated: true,
    path: fixturePath,
  };
}

function findDefaultChromeExecutable() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];

  return candidates.find((candidate) => existsSync(candidate)) || '';
}

function addCheck(checks, checkId, status, label, details = {}) {
  checks.push({
    checkId,
    details,
    label,
    status: status === 'fail' || status === 'warn' ? status : 'ok',
  });
}

function isManagedUiBrowserWorkflowOk(browserWorkflow) {
  return Boolean(
    browserWorkflow?.deliveryPackageVisible === true &&
      browserWorkflow?.manifestVisible === true &&
      browserWorkflow?.outputArtifactVisible === true &&
      browserWorkflow?.artifactContentEndpointFetched === true &&
      browserWorkflow?.artifactContentAuthorizationVerified === true &&
      browserWorkflow?.artifactDownloadContentFetched === true &&
      browserWorkflow?.artifactDownloadAuthorizationVerified === true &&
      browserWorkflow?.artifactDownloadButtonVisible === true &&
      browserWorkflow?.outputPreviewBlobUrl === true &&
      browserWorkflow?.providerConformanceVerified === true &&
      browserWorkflow?.resultsPageVerified === true &&
      browserWorkflow?.settingsSaved === true &&
      browserWorkflow?.doctorVerified === true &&
      browserWorkflow?.diagnosticsBundleVerified === true &&
      browserWorkflow?.settingsRedactionVerified === true &&
      browserWorkflow?.localPathLeakVisible !== true,
  );
}

function isHostArtifactContentUrl(value, hostUrl) {
  const normalizedHostUrl = normalizeUrl(hostUrl);
  const contentPathPattern = /\/tasks\/[^/]+\/artifacts\/[^/]+\/content$/;

  try {
    const parsedValue = new URL(value);
    const parsedHost = new URL(normalizedHostUrl);
    return (
      parsedValue.origin === parsedHost.origin &&
      parsedValue.pathname.startsWith(`${parsedHost.pathname}/tasks/`) &&
      contentPathPattern.test(parsedValue.pathname)
    );
  } catch {
    return String(value || '').startsWith(`${normalizedHostUrl}/tasks/`) && contentPathPattern.test(String(value || ''));
  }
}

function containsServerLocalPath(value) {
  const text = String(value || '');
  return Boolean(
    /\b[A-Za-z]:\\/.test(text) ||
      /file:\/\//i.test(text) ||
      /(^|[\s"'])\/(?:Users|home|tmp|var|private|mnt|Volumes)\//.test(text) ||
      /artifacts[\\/]runtime[\\/]managed-ui-smoke-workspace/i.test(text),
  );
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

function printHumanReport(report) {
  const lines = [
    'SDKWork Video Cut Managed UI Workflow Smoke',
    `profile: ${report.profile}`,
    `deploymentMode: ${report.deploymentMode}`,
    `hostUrl: ${report.hostUrl}`,
    `webUrl: ${report.webUrl}`,
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
    const options = parseManagedUiSmokeArgs(process.argv.slice(2));
    const report = await createManagedUiWorkflowSmokeReport(options);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report);
    }

    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const failure = {
      error: {
        code: 'MANAGED_UI_WORKFLOW_SMOKE_FAILED',
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
