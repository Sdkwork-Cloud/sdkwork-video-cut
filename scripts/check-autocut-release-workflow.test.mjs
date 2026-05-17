#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'autocut-desktop-release.yml');
assert.equal(fs.existsSync(workflowPath), true, 'AutoCut desktop release workflow exists');

const workflow = fs.readFileSync(workflowPath, 'utf8');

function workflowJobBody(jobName, source = workflow) {
  const normalizedSource = source.replace(/\r\n?/gu, '\n');
  const pattern = new RegExp(`\\n  ${jobName}:\\n(?<body>[\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n|\\n*$)`, 'u');
  return normalizedSource.match(pattern)?.groups?.body ?? '';
}

const linuxJob = workflowJobBody('build-linux');
const macosJob = workflowJobBody('build-macos');
const macosJobFromCrlfCheckout = workflowJobBody('build-macos', workflow.replace(/\n/gu, '\r\n'));

for (const marker of [
  'name: AutoCut Desktop Multiplatform Release',
  'workflow_dispatch:',
  'release_tag:',
  'build-windows',
  'build-linux',
  'build-macos',
  'windows-latest',
  'ubuntu-22.04',
  'macos-latest',
  'macos-15-intel',
  'x86_64-apple-darwin',
  'aarch64-apple-darwin',
  'app_arch: x64',
  'app_arch: aarch64',
  'libwebkit2gtk-4.1-dev',
  'libayatana-appindicator3-dev',
  'librsvg2-dev',
  'pnpm/action-setup',
  'Install CI FFmpeg',
  'Prepare release sidecars',
  'prepare:release-sidecars',
  'release:smoke-preflight',
  'release:native-smoke',
  'release:smart-slice-sample',
  'release:installer-signature -- --platform windows-x86_64',
  'release:installer-signature -- --platform linux-x86_64',
  'release:installer-signature -- --platform ${{ matrix.platform }}',
  'release:evidence',
  'release:package-sbom -- --platform windows-x86_64',
  'release:package-sbom -- --platform linux-x86_64',
  'release:package-sbom -- --platform ${{ matrix.platform }}',
  'release:sbom-evidence -- --release-tag "${{ inputs.release_tag }}" --allow-blocked',
  'release:sync-app-manifest -- --dry-run --allow-blocked',
  'release:app-manifest-ready',
  'release:evidence-status -- --release-tag "${{ inputs.release_tag }}"',
  'autocut-release-evidence-windows-x86_64.json',
  'autocut-release-evidence-linux-x86_64.json',
  'autocut-release-evidence-${{ matrix.platform }}.json',
  'artifacts/release/sbom/*.cdx.json',
  'autocut-sbom-evidence.json',
  'autocut-app-manifest-release-readiness.txt',
  'autocut-app-manifest-release-evidence-sync.txt',
  'autocut-release-evidence-status.json',
  'actions/upload-artifact',
  'gh release upload',
  'SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE',
  'MACOS_SIGNING_CERTIFICATE',
  'APPLE_ID',
]) {
  assert.ok(workflow.includes(marker), `workflow contains ${marker}`);
}

assert.match(
  workflow,
  /release:smoke-preflight -- --platform \$\{\{ matrix\.platform \}\} --require-bundled/u,
  'workflow runs platform-specific bundled FFmpeg smoke preflight',
);
assert.match(
  workflow,
  /prepare:release-sidecars -- --platform windows-x86_64 --accept-license/u,
  'workflow prepares approved Windows release sidecars without requiring GitHub Actions to fetch Git LFS objects',
);
assert.match(
  workflow,
  /Install CI FFmpeg[\s\S]*choco install ffmpeg -y --no-progress[\s\S]*Verify workspace/u,
  'Windows release verification installs CI FFmpeg before pnpm test so Smart Slice real-media e2e does not depend on runner PATH state',
);
assert.match(
  workflow,
  /Install Linux Tauri dependencies[\s\S]*ffmpeg[\s\S]*Verify workspace/u,
  'Linux release verification installs FFmpeg before pnpm test so Smart Slice real-media e2e can run in a clean runner',
);
assert.match(
  workflow,
  /Install CI FFmpeg[\s\S]*brew install ffmpeg[\s\S]*Verify workspace/u,
  'macOS release verification installs CI FFmpeg before pnpm test so Smart Slice real-media e2e can run in a clean runner',
);
assert.equal(
  linuxJob.includes('brew install ffmpeg'),
  false,
  'Linux release job must not call Homebrew when installing FFmpeg',
);
assert.match(
  macosJob,
  /Install CI FFmpeg[\s\S]*brew list ffmpeg[\s\S]*brew install ffmpeg[\s\S]*Verify workspace/u,
  'macOS release job installs FFmpeg with Homebrew before pnpm test',
);
assert.match(
  macosJobFromCrlfCheckout,
  /Install CI FFmpeg[\s\S]*brew list ffmpeg[\s\S]*brew install ffmpeg[\s\S]*Verify workspace/u,
  'macOS release job extraction works with CRLF workflow checkouts on Windows runners',
);
assert.match(
  workflow,
  /pnpm tauri:build --target x86_64-unknown-linux-gnu/u,
  'workflow builds Linux from the repository-root pnpm Tauri command',
);
assert.match(
  workflow,
  /pnpm tauri:build --target \$\{\{ matrix\.rust_target \}\}/u,
  'workflow builds macOS matrix targets from the repository-root pnpm Tauri command',
);
assert.match(
  workflow,
  /releaseVersion="\$\{\{ inputs\.release_tag \}\}"[\s\S]*releaseVersion="\$\{releaseVersion#v\}"[\s\S]*SDKWork Video Cut_\$\{releaseVersion\}_\$\{\{ matrix\.app_arch \}\}\.app\.tar\.gz/u,
  'workflow archives macOS app bundles with release-tag-derived architecture-specific asset names',
);
assert.match(
  workflow,
  /rm -f "\$\(dirname "\$appBundle"\)"\/\*\.app\.tar\.gz/u,
  'workflow removes stale macOS app archives before uploading architecture-specific bundles',
);
assert.equal(
  workflow.includes('pnpm tauri:build -- --target'),
  false,
  'workflow passes release target triples to the Tauri CLI instead of cargo runner args',
);
assert.equal(
  workflow.includes('tauri-apps/tauri-action'),
  false,
  'workflow avoids package-path Tauri action builds so release sidecar checks and workspace scripts stay consistent',
);
assert.equal(
  workflow.includes('lfs: true'),
  false,
  'workflow does not fetch Git LFS objects during checkout so release builds are not blocked by LFS bandwidth quota',
);
assert.match(
  workflow,
  /lfs: false/u,
  'workflow explicitly disables Git LFS checkout for native release jobs',
);
const releaseTagCheckoutCount = (workflow.match(/ref: \$\{\{ inputs\.release_tag \}\}/gu) ?? []).length;
assert.equal(
  releaseTagCheckoutCount,
  4,
  'workflow checks out the requested release tag in every release job so uploaded assets match the GitHub Release tag',
);
assert.match(
  workflow,
  /\$PSNativeCommandUseErrorActionPreference = \$true[\s\S]*pnpm release:native-smoke -- --run-real-llm-secret-smoke/u,
  'Windows release evidence step fails immediately when native smoke exits nonzero',
);
assert.match(
  workflow,
  /if \(-not \(Test-Path -LiteralPath "artifacts\/release\/autocut-release-evidence-windows-x86_64\.json"\)\)/u,
  'workflow validates the expected Windows release evidence file before uploading assets',
);
assert.equal(
  workflow.includes('Copy-Item -LiteralPath packages/sdkwork-autocut-desktop/src-tauri/binaries/windows-x86_64/*'),
  false,
  'workflow does not use -LiteralPath with a wildcard when staging Windows sidecars',
);
assert.equal(
  workflow.includes('prepare:speech-sidecar -- --platform windows_x86_64'),
  false,
  'workflow never uses misspelled Windows platform spelling for speech sidecars',
);
assert.match(
  workflow,
  /prepare:release-sidecars -- --platform linux-x86_64 --accept-license/u,
  'workflow prepares approved Linux release sidecars before native packaging',
);
assert.match(
  workflow,
  /prepare:release-sidecars -- --platform \$\{\{ matrix\.platform \}\} --accept-license/u,
  'workflow prepares approved macOS release sidecars for the matrix platform before native packaging',
);
assert.match(
  workflow,
  /release:evidence -- --platform \$\{\{ matrix\.platform \}\} --output artifacts\/release\/autocut-release-evidence-\$\{\{ matrix\.platform \}\}\.json/u,
  'workflow writes platform-specific release evidence',
);
assert.match(
  workflow,
  /release:package-sbom -- --platform windows-x86_64/u,
  'workflow writes Windows per-package CycloneDX SBOM files',
);
assert.match(
  workflow,
  /release:package-sbom -- --platform linux-x86_64/u,
  'workflow writes Linux per-package CycloneDX SBOM files',
);
assert.match(
  workflow,
  /release:package-sbom -- --platform \$\{\{ matrix\.platform \}\}/u,
  'workflow writes macOS per-package CycloneDX SBOM files',
);
assert.match(
  workflow,
  /release:multiplatform-ready/u,
  'workflow verifies aggregate multiplatform preview readiness',
);
assert.match(
  workflow,
  /release:app-manifest-ready/u,
  'workflow verifies app manifest release readiness before uploading aggregate release evidence',
);
assert.match(
  workflow,
  /find artifacts\/downloaded-release \\\( -name '\*\.cdx\.json' -o -name '\*\.cyclonedx\.json' -o -name '\*\.spdx\.json' -o -name '\*\.sbom\.json' \\\) -exec cp \{\} artifacts\/release\/sbom\/ \\;/u,
  'workflow collects SBOM files before writing aggregate SBOM evidence',
);
assert.match(
  workflow,
  /release:sbom-evidence -- --release-tag "\$\{\{ inputs\.release_tag \}\}" --allow-blocked/u,
  'workflow writes aggregate SBOM evidence before app manifest synchronization',
);
assert.match(
  workflow,
  /release:sync-app-manifest -- --dry-run --allow-blocked/u,
  'workflow dry-runs release evidence to app manifest synchronization before aggregate readiness upload without blocking unsigned preview releases',
);
assert.match(
  workflow,
  /release:evidence-status -- --release-tag "\$\{\{ inputs\.release_tag \}\}" --allow-dirty --skip-windows-installer-service --allow-blocked/u,
  'workflow writes an aggregate release evidence status report without bypassing commercial gates',
);
assert.equal(
  workflow.includes('autocut-release-evidence-windows_x86_64.json'),
  false,
  'workflow never uploads a misspelled Windows release evidence filename',
);
assert.match(
  workflow,
  /release:installer-signature -- --platform windows-x86_64/u,
  'workflow writes Windows platform-specific installer signature evidence',
);
assert.match(
  workflow,
  /release:installer-signature -- --platform linux-x86_64/u,
  'workflow writes Linux platform-specific installer signature evidence',
);
assert.match(
  workflow,
  /release:installer-signature -- --platform \$\{\{ matrix\.platform \}\}/u,
  'workflow writes macOS platform-specific installer signature evidence',
);
assert.match(
  workflow,
  /runs-on: \$\{\{ matrix\.runner \}\}[\s\S]*platform: macos-x86_64[\s\S]*runner: macos-15-intel[\s\S]*platform: macos-aarch64[\s\S]*runner: macos-latest/u,
  'workflow selects Intel and Apple Silicon macOS runners explicitly',
);

console.log('ok - autocut desktop release workflow contract');
