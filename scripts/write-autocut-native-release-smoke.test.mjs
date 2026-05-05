#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutNativeReleaseSmokeEvidence,
  formatAutoCutNativeReleaseSmokeEvidenceMessage,
  writeAutoCutNativeReleaseSmokeEvidence,
} from './write-autocut-native-release-smoke.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeFixture(root) {
  const tauriDir = path.join(root, 'packages', 'sdkwork-autocut-desktop', 'src-tauri');
  const targetDir = path.join(tauriDir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(tauriDir, 'Cargo.toml'), '[package]\nname = "sdkwork-video-cut-desktop"\nversion = "0.1.0"\nedition = "2024"\n');
  fs.writeFileSync(path.join(targetDir, '.keep'), '');
}

const root = tempRoot('autocut-native-release-smoke');
writeFixture(root);

const runCommandCalls = [];
const evidence = createAutoCutNativeReleaseSmokeEvidence({
  rootDir: root,
  generatedAt: '2026-05-05T00:00:00.000Z',
  skipRustSmoke: false,
  runCommand(command, args, options) {
    runCommandCalls.push({ command, args, cwd: options.cwd, env: options.env });
    return {
      status: 0,
      stdout: 'test result: ok. 3 passed; 0 failed; 0 ignored',
      stderr: '',
    };
  },
});

assert.equal(evidence.schemaVersion, '2026-05-05.autocut-native-release-smoke.v1');
assert.equal(evidence.generatedAt, '2026-05-05T00:00:00.000Z');
assert.equal(evidence.nativeHost.packageName, 'sdkwork-video-cut-desktop');
assert.equal(evidence.nativeHost.manifestPath, 'packages/sdkwork-autocut-desktop/src-tauri/Cargo.toml');
assert.match(evidence.nativeHost.cargoTargetDirs.rustSmoke, /sdkwork-autocut-native-smoke-target-rust-/u);
assert.match(evidence.nativeHost.cargoTargetDirs.llmSecretStoreSmoke, /sdkwork-autocut-native-smoke-target-llm-secret-/u);
assert.notEqual(evidence.nativeHost.cargoTargetDirs.rustSmoke, evidence.nativeHost.cargoTargetDirs.llmSecretStoreSmoke);
assert.equal(evidence.readiness.nativeReleaseSmokeReady, false);
assert.equal(evidence.readiness.ffmpegExecutionReady, false);
assert.equal(evidence.readiness.realLlmSecretStoreSmokeReady, false);
assert.equal(evidence.commandMatrix.length, 7);
assert.deepEqual(
  evidence.commandMatrix.map((command) => command.command),
  [
    'autocut_host_capabilities',
    'autocut_ffmpeg_probe',
    'autocut_audio_smoke',
    'autocut_recover_native_tasks',
    'autocut_save_llm_secret',
    'autocut_get_llm_secret',
    'autocut_delete_llm_secret',
  ],
);
assert.equal(
  evidence.commandMatrix.filter((command) => command.command.includes('llm_secret')).every((command) => command.evidenceReady === false),
  true,
);
assert.equal(evidence.llmSecretStoreSmoke.requested, false);
assert.equal(evidence.llmSecretStoreSmoke.skipped, true);
assert.equal(evidence.llmSecretStoreSmoke.success, false);
assert.equal(evidence.rustSmoke.skipped, false);
assert.equal(evidence.rustSmoke.success, true);
assert.match(evidence.rustSmoke.command, /^cargo \+1\.90\.0 test --manifest-path /u);
assert.match(evidence.rustSmoke.stdout, /3 passed/u);
assert.equal(runCommandCalls.length, 1);
assert.equal(runCommandCalls[0].command, 'cargo');
assert.deepEqual(runCommandCalls[0].args.slice(0, 2), ['+1.90.0', 'test']);
assert.match(runCommandCalls[0].env.CARGO_TARGET_DIR, /sdkwork-autocut-native-smoke-target-rust-/u);
assert.equal(runCommandCalls[0].env.CARGO_TARGET_DIR.includes(path.join(root, 'packages')), false);

const skippedEvidence = createAutoCutNativeReleaseSmokeEvidence({
  rootDir: root,
  generatedAt: '2026-05-05T00:00:00.000Z',
  skipRustSmoke: true,
});
assert.equal(skippedEvidence.readiness.nativeReleaseSmokeReady, false);
assert.equal(skippedEvidence.rustSmoke.skipped, true);
assert.equal(skippedEvidence.rustSmoke.success, false);

const realLlmSecretSmokeCalls = [];
const realLlmSecretSmokeEvidence = createAutoCutNativeReleaseSmokeEvidence({
  rootDir: root,
  generatedAt: '2026-05-05T00:00:00.000Z',
  runRealLlmSecretSmoke: true,
  runCommand(command, args, options) {
    realLlmSecretSmokeCalls.push({ command, args, cwd: options.cwd, env: options.env });
    if (args.some((arg) => arg.includes('real_windows_keyring_store_saves_reads_and_deletes_llm_secret'))) {
      return {
        status: 0,
        stdout: 'autocut-real-llm-secret-store-smoke=passed\ntest result: ok. 1 passed; 0 failed; 0 ignored',
        stderr: '',
      };
    }
    return {
      status: 0,
      stdout: 'test result: ok. 3 passed; 0 failed; 0 ignored',
      stderr: '',
    };
  },
});

assert.equal(realLlmSecretSmokeEvidence.readiness.nativeReleaseSmokeReady, true);
assert.equal(realLlmSecretSmokeEvidence.readiness.realLlmSecretStoreSmokeReady, true);
assert.equal(realLlmSecretSmokeEvidence.llmSecretStoreSmoke.requested, true);
assert.equal(realLlmSecretSmokeEvidence.llmSecretStoreSmoke.skipped, false);
assert.equal(realLlmSecretSmokeEvidence.llmSecretStoreSmoke.success, true);
assert.match(realLlmSecretSmokeEvidence.llmSecretStoreSmoke.command, /--ignored --exact --test-threads=1 --nocapture/u);
assert.equal(realLlmSecretSmokeCalls.length, 2);
assert.match(realLlmSecretSmokeCalls[0].env.CARGO_TARGET_DIR, /sdkwork-autocut-native-smoke-target-rust-/u);
assert.match(realLlmSecretSmokeCalls[1].env.CARGO_TARGET_DIR, /sdkwork-autocut-native-smoke-target-llm-secret-/u);
assert.notEqual(realLlmSecretSmokeCalls[1].env.CARGO_TARGET_DIR, realLlmSecretSmokeCalls[0].env.CARGO_TARGET_DIR);
assert.equal(realLlmSecretSmokeCalls[1].env.SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE, 'true');
assert.deepEqual(
  realLlmSecretSmokeEvidence.commandMatrix.filter((command) => command.command.includes('llm_secret')).map((command) => command.evidenceReady),
  [true, true, true],
);

assert.throws(
  () =>
    createAutoCutNativeReleaseSmokeEvidence({
      rootDir: tempRoot('autocut-native-release-smoke-missing'),
      skipRustSmoke: true,
    }),
  /missing AutoCut native host Cargo manifest/u,
);

const outputPath = path.join(root, 'artifacts', 'release', 'autocut-native-release-smoke.json');
const written = writeAutoCutNativeReleaseSmokeEvidence({
  rootDir: root,
  generatedAt: '2026-05-05T00:00:00.000Z',
  outputPath,
  skipRustSmoke: true,
});
const persisted = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

assert.deepEqual(persisted, written.evidence);
assert.equal(
  formatAutoCutNativeReleaseSmokeEvidenceMessage(written),
  `ok - autocut native release smoke evidence ${outputPath} nativeReleaseSmokeReady=false ffmpegExecutionReady=false`,
);

console.log('ok - autocut native release smoke evidence contract');
