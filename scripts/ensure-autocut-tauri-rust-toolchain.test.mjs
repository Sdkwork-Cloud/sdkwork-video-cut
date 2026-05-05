#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  createAutoCutTauriRustToolchainReport,
  ensureAutoCutTauriRustToolchain,
  formatAutoCutTauriRustToolchainMessage,
} from './ensure-autocut-tauri-rust-toolchain.mjs';

function createRunner(outputs) {
  return (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    if (!(key in outputs)) {
      throw new Error(`Unexpected command: ${key}`);
    }

    const value = outputs[key];
    if (value instanceof Error) {
      throw value;
    }

    return value;
  };
}

const passingReport = createAutoCutTauriRustToolchainReport({
  runCommand: createRunner({
    'rustc --version': 'rustc 1.90.0 (1159e78c4 2025-09-14)',
    'cargo --version': 'cargo 1.90.0 (840b83a10 2025-07-30)',
    'rustup target list --installed': 'x86_64-pc-windows-msvc\nwasm32-unknown-unknown',
  }),
});

assert.deepEqual(passingReport, {
  rustcVersion: 'rustc 1.90.0 (1159e78c4 2025-09-14)',
  cargoVersion: 'cargo 1.90.0 (840b83a10 2025-07-30)',
  installedTargets: ['x86_64-pc-windows-msvc', 'wasm32-unknown-unknown'],
});

assert.equal(
  formatAutoCutTauriRustToolchainMessage(passingReport),
  'ok - autocut tauri rust toolchain rustc 1.90.0 (1159e78c4 2025-09-14); cargo 1.90.0 (840b83a10 2025-07-30)',
);

assert.throws(
  () => createAutoCutTauriRustToolchainReport({
    runCommand: createRunner({
      'rustc --version': 'rustc 1.92.0 (ded5c06cf 2025-12-08)',
      'cargo --version': 'cargo 1.92.0 (344c4567c 2025-10-21)',
      'rustup target list --installed': 'x86_64-pc-windows-msvc',
    }),
  }),
  /AutoCut desktop Tauri builds require rustc 1\.90\.0\.[\s\S]*Detected: rustc 1\.92\.0/u,
);

assert.throws(
  () => createAutoCutTauriRustToolchainReport({
    runCommand: createRunner({
      'rustc --version': 'rustc 1.90.0 (1159e78c4 2025-09-14)',
      'cargo --version': 'cargo 1.90.0 (840b83a10 2025-07-30)',
      'rustup target list --installed': 'wasm32-unknown-unknown',
    }),
  }),
  /AutoCut desktop Tauri builds require Rust target x86_64-pc-windows-msvc/u,
);

assert.throws(
  () => ensureAutoCutTauriRustToolchain({
    runCommand: createRunner({
      'rustc --version': new Error('rustc --version failed: command not found'),
    }),
  }),
  /rustc --version failed: command not found/u,
);

console.log('ok - autocut tauri rust toolchain guard contract');
