#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const runtimeDir = resolve(projectRoot, 'artifacts/runtime');
const hostUrl = 'http://127.0.0.1:6177/api/video-cut/v1';
const viteUrl = 'http://127.0.0.1:5173';
const startedProcesses = [];
let shuttingDown = false;

mkdirSync(runtimeDir, { recursive: true });

function spawnManagedProcess(name, command, args, env) {
  const out = createWriteStream(resolve(runtimeDir, `tauri-${name}.out.log`), { flags: 'a' });
  const err = createWriteStream(resolve(runtimeDir, `tauri-${name}.err.log`), { flags: 'a' });
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(out);
  child.stderr.pipe(err);
  child.on('exit', (code, signal) => {
    out.end();
    err.end();
    if (!shuttingDown) {
      console.error(`[tauri-dev] ${name} exited unexpectedly: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      process.exit(code || 1);
    }
  });

  startedProcesses.push(child);
  return child;
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, label) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await isReachable(url)) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  throw new Error(`${label} did not become reachable at ${url}`);
}

async function main() {
  const hostHealthUrl = `${hostUrl}/health`;
  if (!(await isReachable(hostHealthUrl))) {
    spawnManagedProcess('host', 'cargo', ['run', '--manifest-path', 'host/Cargo.toml'], {
      SDKWORK_VIDEO_CUT_RUNTIME_MODE: 'desktop-local',
      SDKWORK_VIDEO_CUT_BIND_HOST: '127.0.0.1',
      SDKWORK_VIDEO_CUT_PORT: '6177',
      SDKWORK_VIDEO_CUT_WORKSPACE_ROOT: './workspace',
      SDKWORK_VIDEO_CUT_AUTH_MODE: 'none',
      SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:5173,http://localhost:5173',
    });
  }
  await waitFor(hostHealthUrl, 'Rust Host');

  if (!(await isReachable(viteUrl))) {
    spawnManagedProcess('web', 'pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
      VITE_VIDEO_CUT_HOST_MODE: 'http',
      VITE_VIDEO_CUT_HOST_BASE_URL: hostUrl,
    });
  }
  await waitFor(viteUrl, 'Vite web app');

  console.log(`[tauri-dev] Host ready: ${hostUrl}`);
  console.log(`[tauri-dev] Web ready: ${viteUrl}`);
  setInterval(() => undefined, 60_000);
}

function cleanup() {
  shuttingDown = true;
  for (const child of startedProcesses) {
    if (!child.killed) {
      child.kill();
    }
  }
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('SIGHUP', cleanup);

main().catch((error) => {
  console.error(`[tauri-dev] ${error instanceof Error ? error.message : String(error)}`);
  cleanup();
  setTimeout(() => process.exit(1), 1_100).unref();
});
