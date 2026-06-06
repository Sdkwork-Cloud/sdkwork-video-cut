#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const frameworkRef = 'b0829529b9277a3da32b90c2d36ff34ff09fa832';
const workflowConfigPath = path.join(process.cwd(), 'sdkwork.workflow.json');
const packageWorkflowPath = path.join(process.cwd(), '.github', 'workflows', 'package.yml');
const legacyWorkflowPath = path.join(process.cwd(), '.github', 'workflows', 'autocut-desktop-release.yml');

assert.equal(fs.existsSync(legacyWorkflowPath), false, 'legacy AutoCut desktop release workflow is removed');
assert.equal(fs.existsSync(workflowConfigPath), true, 'sdkwork.workflow.json exists');
assert.equal(fs.existsSync(packageWorkflowPath), true, 'standard package workflow entrypoint exists');

const workflowConfig = JSON.parse(fs.readFileSync(workflowConfigPath, 'utf8'));
const packageWorkflow = fs.readFileSync(packageWorkflowPath, 'utf8');

assert.equal(workflowConfig.schemaVersion, '2026-06-06.sdkwork.workflow.v1');
assert.deepEqual(workflowConfig.app, {
  id: 'sdkwork-video-cut',
  name: 'SDKWork Video Cut',
  repository: 'Sdkwork-Cloud/sdkwork-video-cut',
  sourcePath: '.',
  configPath: 'sdkwork.app.config.json',
});
assert.equal(workflowConfig.release.artifactPrefix, 'sdkwork-video-cut');
assert.equal(workflowConfig.release.changelog.source, 'auto');
assert.equal(workflowConfig.security.sbomRequired, true);
assert.equal(workflowConfig.publish.githubRelease, true);

const targetIds = workflowConfig.targets.map((target) => target.id).sort();
assert.deepEqual(targetIds, [
  'linux-debian-x64-desktop-deb',
  'linux-x64-desktop-appimage',
  'macos-arm64-desktop-dmg',
  'macos-x64-desktop-dmg',
  'windows-x64-desktop-exe',
  'windows-x64-desktop-msi',
]);

const targetById = new Map(workflowConfig.targets.map((target) => [target.id, target]));
assert.equal(targetById.get('linux-debian-x64-desktop-deb').distribution, 'debian');
assert.equal(targetById.get('windows-x64-desktop-exe').formats[0], 'exe');
assert.equal(targetById.get('macos-arm64-desktop-dmg').architecture, 'arm64');
assert.ok(
  targetById.get('macos-arm64-desktop-dmg').outputGlobs.includes(
    'packages/sdkwork-autocut-desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/*.app.tar.gz',
  ),
  'macOS Apple Silicon target still publishes the app archive as supporting release asset',
);

const lifecycleText = JSON.stringify(workflowConfig.lifecycle);
for (const marker of [
  'pnpm test',
  'prepare:release-sidecars',
  'pnpm tauri:build --target x86_64-unknown-linux-gnu',
  'pnpm tauri:build --target $rustTarget',
  'release:installer-signature',
  'release:package-sbom -- --package-id $env:SDKWORK_PACKAGE_ID',
  'release:smoke-preflight',
  'release:native-smoke -- --run-real-llm-secret-smoke',
  'release:smart-slice-sample',
  'release:evidence -- --platform $platform',
]) {
  assert.ok(lifecycleText.includes(marker), `workflow config lifecycle contains ${marker}`);
}

for (const marker of [
  'name: Package Application',
  'workflow_dispatch:',
  'config_path: sdkwork.workflow.json',
  `Sdkwork-Cloud/sdkwork-github-workflow/.github/workflows/sdkwork-package.yml@${frameworkRef}`,
  `framework_ref: ${frameworkRef}`,
  "package_version: ${{ github.event.inputs.package_version || '' }}",
  'secrets: inherit',
]) {
  assert.ok(packageWorkflow.includes(marker), `package workflow contains ${marker}`);
}

assert.equal(packageWorkflow.includes('gh release upload'), false, 'package workflow delegates Release upload to the reusable framework');
assert.equal(packageWorkflow.includes('actions/upload-artifact'), false, 'package workflow delegates artifact upload to the reusable framework');

console.log('ok - autocut standard release workflow contract');
