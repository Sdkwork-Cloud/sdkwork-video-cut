#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const requiredToolchain = '1.90.0';
const requiredTarget = 'x86_64-pc-windows-msvc';
const __filename = fileURLToPath(import.meta.url);

export function runAutoCutTauriRustToolchainCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }

  return result.stdout.trim();
}

export function createAutoCutTauriRustToolchainReport({
  runCommand = runAutoCutTauriRustToolchainCommand,
} = {}) {
  const rustcVersion = runCommand('rustc', ['--version']);
  const cargoVersion = runCommand('cargo', ['--version']);

  if (!rustcVersion.includes(requiredToolchain)) {
    throw new Error([
      `AutoCut desktop Tauri builds require rustc ${requiredToolchain}.`,
      `Detected: ${rustcVersion}`,
      'The package-local toolchain file is packages/sdkwork-autocut-desktop/rust-toolchain.toml.',
      `Install it with: rustup toolchain install ${requiredToolchain}-${requiredTarget}`,
    ].join('\n'));
  }

  const installedTargets = runCommand('rustup', ['target', 'list', '--installed'])
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!installedTargets.includes(requiredTarget)) {
    throw new Error([
      `AutoCut desktop Tauri builds require Rust target ${requiredTarget}.`,
      `Install it with: rustup target add ${requiredTarget} --toolchain ${requiredToolchain}-${requiredTarget}`,
    ].join('\n'));
  }

  return {
    rustcVersion,
    cargoVersion,
    installedTargets,
  };
}

export function formatAutoCutTauriRustToolchainMessage(report) {
  return `ok - autocut tauri rust toolchain ${report.rustcVersion}; ${report.cargoVersion}`;
}

export function ensureAutoCutTauriRustToolchain(options = {}) {
  const report = createAutoCutTauriRustToolchainReport(options);
  return formatAutoCutTauriRustToolchainMessage(report);
}

function main() {
  console.log(ensureAutoCutTauriRustToolchain());
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
