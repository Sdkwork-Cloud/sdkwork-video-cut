#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const runtimeDir = resolve(projectRoot, 'artifacts/runtime');
const hostUrl = 'http://127.0.0.1:6177/api/video-cut/v1';
const viteUrl = 'http://127.0.0.1:5173';
const commandProcesses = [];
let shuttingDown = false;

mkdirSync(runtimeDir, { recursive: true });

function commandName(command) {
  return command;
}

function spawnLogged(name, command, args, env = {}) {
  const out = createWriteStream(resolve(runtimeDir, `${name}.out.log`), { flags: 'a' });
  const err = createWriteStream(resolve(runtimeDir, `${name}.err.log`), { flags: 'a' });
  const child = spawn(commandName(command), args, {
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
    if (!shuttingDown && name.includes('tauri-dev-app')) {
      cleanup(code || (signal ? 1 : 0));
    }
  });

  commandProcesses.push(child);
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
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isReachable(url)) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  throw new Error(`${label} did not become reachable at ${url}`);
}

async function main() {
  const stack = spawnLogged('tauri-dev-stack', 'node', ['scripts/run-video-cut-tauri-dev-stack.mjs']);
  await waitFor(`${hostUrl}/health`, 'Rust Host');
  await waitFor(viteUrl, 'Vite web app');

  console.log(`[tauri-dev] Host ready: ${hostUrl}`);
  console.log(`[tauri-dev] Web ready: ${viteUrl}`);

  const tauriConfigOverridePath = resolve(runtimeDir, 'tauri-dev.override.json');
  writeFileSync(tauriConfigOverridePath, JSON.stringify({
    build: {
      beforeDevCommand: '',
    },
  }, null, 2), 'utf8');

  const tauri = spawnLogged(
    'tauri-dev-app',
    'pnpm',
    ['exec', 'tauri', 'dev', '--config', tauriConfigOverridePath, '--no-dev-server-wait'],
    {
      VITE_VIDEO_CUT_HOST_MODE: 'http',
      VITE_VIDEO_CUT_HOST_BASE_URL: hostUrl,
    },
  );

  stack.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[tauri-dev] dev stack exited unexpectedly: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      tauri.kill();
      cleanup(code || 1);
    }
  });
}

function cleanup(exitCode = 0) {
  shuttingDown = true;
  for (const child of commandProcesses) {
    if (!child.killed) {
      child.kill();
    }
  }
  setTimeout(() => process.exit(exitCode), 1_000).unref();
}

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
process.on('SIGHUP', () => cleanup(0));

main().catch((error) => {
  console.error(`[tauri-dev] ${error instanceof Error ? error.message : String(error)}`);
  cleanup(1);
});
