# SDKWork Video Cut Release Notes

This directory is the release source of truth for SDKWork Video Cut.

Each GitHub Release must reference the matching version note in this
directory. If a previous version was not successfully released, its change log
must be folded into the next successful release instead of leaving orphaned
release notes.

## v0.1.3 - 2026-05-09

Multiplatform unsigned preview release hardening for Phase 1, with Phase 2
commercial release standards documented and enforced as blockers. This release
also folds in the unreleased smart slicing, speech-to-text, subtitle, recovery,
and release-governance work completed after the `v0.1.0` tag, plus the failed
`v0.1.1` and `v0.1.2` multiplatform release attempts that created GitHub
Releases without assets.

### Release Scope

- Adds `.github/workflows/autocut-desktop-release.yml` as the native
  multiplatform desktop release workflow backed by `tauri-apps/tauri-action`.
- Builds Windows x86_64 on `windows-latest`, Ubuntu/Linux x86_64 on
  `ubuntu-22.04`, and macOS Intel plus Apple Silicon on `macos-latest` using
  `x86_64-apple-darwin` and `aarch64-apple-darwin`.
- Prepares release sidecars before native packaging on every runner: Windows
  re-verifies the approved Git LFS FFmpeg and `whisper-cli` sidecars, while
  Linux and macOS use the standardized CI sidecar preparation script to fetch
  or build the approved platform-native FFmpeg and Whisper CLI tools before
  Tauri packaging.
- Keeps `v0.1.0` as the existing Windows unsigned preview and uses `v0.1.3` for
  the first four-platform preview release line.
- Updates the root workspace, every AutoCut package manifest, the Tauri app
  version, and the Rust desktop crate version to `0.1.3` so Git tags,
  installer metadata, application metadata, and release notes all describe the
  same version.
- Includes all post-`v0.1.0` fixes and the failed `v0.1.1` and `v0.1.2`
  release attempts. `v0.1.1` and `v0.1.2` were tagged and GitHub Releases were
  created, but their multiplatform workflows failed before uploading release
  assets. No orphaned intermediate release notes are left outside this release
  entry.

### Post-Preview Product Hardening Folded Into This Release

- Fixes Smart Slice progress reporting so transcript, planning, native render,
  artifact verification, and result persistence advance through explicit
  logged execution steps instead of stalling at 35%.
- Emits a full Smart Slice execution plan and stage-level console diagnostics
  before and during native processing so release and product debugging can
  identify the exact failing stage.
- Replaces recovered smart-slice artifacts without transcript evidence with a
  fail-closed recovery path that requires verified STT transcript segments,
  transcript text, coverage score, and continuity metadata.
- Fixes sparse-transcript planning failures by enforcing publishable
  transcript-backed planning standards before native rendering.
- Keeps the player as a preview surface and routes actual slicing through the
  native desktop host and FFmpeg pipeline instead of coupling media rendering
  to WebGL preview state.
- Adds native FFmpeg encoder fallback governance for Smart Slice rendering:
  platform hardware encoders are attempted first where available, with a CPU
  fallback kept as the final supported path.
- Moves generated video task cover images into the dedicated task cover
  directory so task videos and cover thumbnails follow separate, auditable
  artifact roots.

### Local Speech-To-Text Initialization

- Makes the local Whisper CLI provider the default STT path for
  transcript-assisted workflows and checks Settings, environment variables,
  bundled sidecars, PATH, Homebrew, apt/system paths, and common installation
  directories before failing.
- Adds product-facing Smart Slice initialization that opens a setup dialog,
  starts local STT readiness checks automatically, shows model download
  progress, and only proceeds once the local STT provider is verified.
- Defines default executable and model directories for Windows, macOS, and
  Ubuntu/Linux, while keeping runtime executable download disabled until an
  approved licensed whisper-cli sidecar is packaged.
- Packages the speech-transcription sidecar manifest as a Tauri resource and
  validates bundled whisper-cli sidecars through byte-size and SHA-256
  integrity metadata.
- Bundles the approved Windows x86_64 `whisper-cli` sidecar through Git LFS
  for this release and records the required runtime DLL companion files with
  their own SHA-256 and byte-size integrity metadata.
- Adds `pnpm prepare:release-sidecars` for CI-only native runner sidecar
  preparation so Linux and macOS installers can package platform-native local
  STT and FFmpeg tools without committing every platform binary into the
  Windows development checkout.
- Supports trusted Hugging Face and mirror URLs for the recommended offline
  Whisper model download, with pinned file-name, extension, and digest
  validation before local model installation is accepted.

### Task Center Experience

- Adds multi-select task operations for cancel, retry, delete, and clear
  selection while delegating status-aware batch behavior to the task service.
- Simplifies the task list header so status tabs sit at the far-left primary
  operation position and no longer consume excessive vertical space.
- Keeps selected-task bulk actions inside the same compact toolbar row instead
  of adding a second full-width header banner when tasks are selected.
- Fixes task list time display by routing timestamps through the canonical
  local datetime formatter instead of rendering raw UTC/SQLite task strings.
- Treats native SQLite UTC timestamps without a timezone suffix as UTC instants
  so task ordering and display remain correct across local time zones.
- Fixes the slicer task side list time preview by replacing raw
  `createdAt.split(...)` logic with a canonical local time-of-day formatter.
- Keeps task type labels based on stable task type ids and i18n labels so
  Smart Slice tasks no longer appear as unrelated text-extraction tasks.

### Intelligent Slicing Standard

- Makes speech-to-text mandatory for native intelligent slicing even when
  subtitles are disabled.
- Requires each generated smart slice to expose visible speech-to-text
  transcript text, structured transcript segments, and matching segment counts.
- Adds a native-render readiness gate before `sliceVideo` dispatch so invalid
  plans fail closed before media is rendered.
- Rejects planned clips that are empty, out of order, overlapping, outside the
  imported source duration, missing real STT coverage, or inconsistent with the
  structured transcript evidence.
- Enforces the professional speech boundary standard before and after native
  rendering: no more than 200ms leading silence and 250ms trailing silence
  around the spoken content.
- Keeps slice transcript text derived from real STT segments instead of stale
  LLM summaries, and verifies transcript text matches structured segment text.
- Requires `transcriptCoverageScore >= 0.8` and speech continuity grade
  `strong` or `repaired` for completed smart slices.
- Preserves clip content continuity by keeping source windows ordered,
  non-overlapping, and tied to continuous transcript-backed speech boundaries.

### Speech-To-Text And Text Extraction

- Sets the default STT provider to the offline local Whisper CLI provider.
- Sets the recommended offline default model preset to
  `whisper-cpp-large-v3-turbo-q5`.
- Supports structured transcript extraction from both audio and video sources.
- Persists task-level `transcriptText`, `transcriptSegments`,
  `transcriptSegmentCount`, `transcriptProviderId`, and
  `transcriptSourceAssetId` for STT-backed text extraction.
- Keeps raw extraction mode aligned with native STT output while filtered mode
  removes redundant filler text without breaking structured transcript segment
  evidence.
- Formats and downloads extracted text from structured task-level transcript
  segments when available.

### Subtitle Behavior

- Keeps subtitles disabled by default.
- Keeps STT required for smart slicing independently of subtitle rendering.
- Allows SRT/burned subtitle generation only when the user explicitly enables
  subtitles.
- Rejects contradictory subtitle requests, such as enabling subtitles with
  `subtitleMode: none`.
- Rejects unexpected subtitle sidecars when subtitle rendering was not
  requested and requires requested subtitle artifacts when SRT output is
  enabled.

### Native Task Recovery And Evidence

- Projects native STT tasks into the same structured transcript fields used by
  live text extraction and smart slicing.
- Fails closed when recovered native STT tasks are missing transcript text,
  structured segments, matching segment counts, or transcript text aligned to
  structured segments.
- Backfills recovered native video slice transcript evidence only from trusted
  same-source native STT sibling tasks.
- Continues to reject recovered native slice artifacts without speech-to-text
  transcript evidence.
- Validates recovered native smart slices against the same speech boundary,
  transcript coverage, and continuity standards used by live smart slicing.

### Release Engineering And Dependency Policy

- Keeps local AutoCut package dependencies as `workspace:*` for development.
- Keeps release distribution through the GitHub repository and GitHub Release
  assets instead of publishing the internal AutoCut packages to npm central.
- Updates `sdkwork.app.config.json` to the `v0.1.3` release line and points the
  desktop package matrix at the GitHub Release asset names for Windows MSI/NSIS,
  Linux DEB/AppImage, and macOS Intel/Apple Silicon DMG packages.
- Keeps all install packages disabled in the app manifest until real GitHub
  Release assets, SHA-256 checksums, installer trust evidence, and SBOM evidence
  are recorded. The manifest must not publish placeholder CDN packages as
  installable commercial assets.
- Removes the stale `STABLE/0.1.0` CDN package URLs from the current app
  manifest so the package catalog cannot drift behind the application version.
- Confirms this repository does not declare direct source dependencies on
  `sdkwork-core`, `sdkwork-ui`, `sdkwork-appbase`, or `sdkwork-im-sdk` at this
  release point.
- Fixes release workflow test isolation so CI jobs with
  `SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE=true` do not accidentally force
  unrelated release-smoke contract fixtures through the real Windows credential
  store path.
- Makes the local STT i18n governance check line-ending tolerant so Windows
  checkout newline conversion cannot fail an otherwise valid Chinese resource
  localization check.
- Fixes the cross-platform release-environment contract so Linux and macOS CI
  jobs no longer expect the Windows Installer Service blocker in mocked
  non-Windows reports.
- Fixes Windows CI sidecar staging by using PowerShell wildcard path expansion
  instead of `Copy-Item -LiteralPath` with a wildcard when copying the approved
  Git LFS FFmpeg and Whisper CLI sidecars into the release-preparation staging
  directory.
- Centralizes release installer discovery by platform so release evidence and
  signing scripts derive installer paths from the current application version
  instead of hard-coded historical filenames.
- Adds `pnpm release:environment` as the release-operator preflight. It reports
  `.git` metadata write access, Git remote reachability, GitHub CLI
  authentication, Node child-process spawning, and Windows Installer Service
  availability as explicit blockers before attempting push, tag, or GitHub
  Release operations.
- Keeps native release smoke platform-aware: Windows release evidence requires
  the real Windows Credential Manager LLM secret smoke, while Linux and macOS
  record that the Windows-only secret-store smoke is not applicable and keep
  native video slicing plus common native command evidence as the cross-platform
  release gate.

### Phase 1 Preview Release Gate

- Adds the aggregate `pnpm release:multiplatform-ready` gate.
- Requires four platform release evidence files:
  `autocut-release-evidence-windows-x86_64.json`,
  `autocut-release-evidence-linux-x86_64.json`,
  `autocut-release-evidence-macos-x86_64.json`, and
  `autocut-release-evidence-macos-aarch64.json`.
- Requires platform installer artifacts with byte size and SHA-256 digest:
  Windows MSI/NSIS, Linux DEB/AppImage, and macOS DMG/app archive.
- Requires bundled FFmpeg sidecar integrity, executable smoke, native video
  slicing smoke, smart slice quality evidence, smart slice media artifact
  evidence, and release smoke readiness for every platform.
- Allows unsigned installers only as explicit preview warnings:
  `UNSIGNED_INSTALLERS_ACCEPTED_FOR_PREVIEW` and
  `UNSIGNED_MACOS_INSTALLERS_ACCEPTED_FOR_PREVIEW`.

### Release Evidence And Installer Discovery

- Adds `scripts/autocut-release-platforms.mjs` as the canonical platform and
  installer artifact registry.
- Updates `pnpm release:installer-signature` so `--platform` selects the correct
  platform trust evidence path instead of assuming Windows MSI/NSIS on every
  host.
- Updates `pnpm release:evidence -- --platform <platform>` so installer
  discovery works for Windows, Linux, macOS Intel, and macOS Apple Silicon.
- Keeps non-Windows preview evidence honest: Linux and macOS write artifact
  digest evidence but remain blocked for commercial signing/notarization until
  Phase 2 is complete.

### Phase 2 Commercial Standard

- Documents the Phase 2 requirements for public commercial release:
  Windows Authenticode signing, macOS Developer ID signing plus Gatekeeper
  assessment and notarization, Linux package signing policy, and Linux
  `.deb`/`.AppImage` install smoke.
- Requires production app manifests to set `checksumRequired`,
  `signatureRequired`, and `sbomRequired` to `true`; disabled preview packages
  remain blocked until their real release checksums, signatures/notarization,
  Linux trust evidence, and SBOM locations are recorded.
- Adds `pnpm release:app-manifest-ready` to distinguish inactive preview
  manifests from active commercial manifests. Inactive preview packages may
  remain disabled without fabricated checksums only when they record
  `commercialActivationRequired`; active commercial packages must have real
  SHA-256 checksums, verified platform trust evidence, and CycloneDX or SPDX
  SBOM metadata before they can be enabled.
- Adds `pnpm release:package-sbom` to generate deterministic CycloneDX 1.6 SBOM
  files per desktop release package from workspace manifests, `pnpm-lock.yaml`,
  desktop `Cargo.toml`, and desktop `Cargo.lock`. The generator supports
  platform-scoped output for native release jobs and fails closed when runtime
  npm dependency versions cannot be resolved from the lockfile.
- Adds `pnpm release:sbom-evidence` to aggregate real per-package CycloneDX or
  SPDX SBOM files from `artifacts/release/sbom/` into
  `artifacts/release/autocut-sbom-evidence.json`. The writer computes byte size
  and SHA-256 from file contents and blocks missing, empty, invalid,
  unknown-package, or duplicate SBOM inputs instead of accepting fabricated
  checksum metadata.
- Adds `pnpm release:sync-app-manifest` as the evidence-to-manifest bridge. It
  reads the four platform `autocut-release-evidence-<platform>.json` files plus
  `autocut-sbom-evidence.json`, maps installer artifacts to the manifest package
  ids, and only writes checksum, size, trust evidence, and SBOM metadata when
  every package has complete real release evidence. CI uses this in
  `--dry-run --allow-blocked` mode so unsigned preview releases publish the
  commercial-activation blockers without failing; `--activate-commercial` is
  reserved for the post-asset commercial activation step.
- Adds `pnpm release:evidence-status` as the aggregate release evidence status
  report. It composes the release environment probe, four-platform release
  evidence, SBOM evidence, app manifest sync dry run, app manifest readiness,
  multiplatform preview readiness, and commercial readiness into one
  domain-indexed blocker report with next commands. Preview CI may upload the
  `--allow-blocked --json` report, while commercial releases must run the gate
  without `--allow-blocked` before tag push or final GitHub Release upload.
- Keeps the upstream SDKWork v3 app standard validator as a final post-asset
  gate. Because that validator requires checksums whenever
  `checksumRequired=true`, the current preview manifest must not add fake
  checksums simply to pass it before real GitHub Release assets exist.
- Removes third-party remote media fixtures and Tauri CSP allowances for
  SoundHelix, Giphy, and Picsum so the desktop app no longer depends on public
  demo media domains or loads external sample resources at runtime.
- Updates `pnpm release:commercial-ready` to be a four-platform aggregate gate
  by default, using `autocut-release-evidence-<platform>.json` files for
  Windows, Linux, macOS Intel, and macOS Apple Silicon. A single `--evidence`
  path remains available only for explicit platform diagnostics.
- Keeps `pnpm release:commercial-ready` as the final hard gate and prevents
  unsigned preview evidence from being treated as a commercial release. The
  gate also directly validates platform installer artifacts, requiring the
  expected installer kinds, positive byte sizes, and real SHA-256 digests before
  commercial readiness can pass.

### Verification For This Unsigned Preview Release

The release must pass the current local governance and workflow contract checks
before the GitHub workflow is used:

- `pnpm check:autocut-architecture`
- `node scripts/check-autocut-release-workflow.test.mjs`
- `node scripts/write-autocut-installer-signature-evidence.test.mjs`
- `node scripts/write-autocut-release-evidence.test.mjs`
- `node scripts/sync-autocut-app-manifest-release-evidence.test.mjs`
- `node scripts/check-autocut-app-manifest-release-readiness.test.mjs`
- `node scripts/check-autocut-multiplatform-release-readiness.test.mjs`
- `node scripts/check-autocut-release-environment.test.mjs`
- `node scripts/check-autocut-release-evidence-status.test.mjs`
- `pnpm test`

The GitHub workflow must then complete all native build jobs and the aggregate
`pnpm release:multiplatform-ready` and `pnpm release:evidence-status -- --release-tag v0.1.3 --allow-blocked`
jobs before `v0.1.3` assets are considered a complete multiplatform unsigned
preview release.

## v0.1.0 - 2026-05-05

Initial commercial desktop release baseline for the package-local Tauri
AutoCut application.

### Release Scope

- Establishes the desktop application under
  `packages/sdkwork-autocut-desktop`, matching the package-local architecture
  used by `sdkwork-birdcoder`.
- Removes the obsolete top-level Tauri application structure and keeps the
  repository root as workspace orchestration only.
- Ships the Windows x86_64 desktop release target for `SDKWork Video Cut`
  version `0.1.0`.
- Bundles the approved Windows FFmpeg sidecar through Git LFS with manifest
  integrity metadata.

### Product And Frontend Modules

- Preserves the product design and visual implementation defined by the
  `packages/sdkwork-autocut-*` modules.
- Adds package-standard feature modules for home, assets, messages, settings,
  tools, tasks, slicer, text extraction, audio extraction, GIF generation,
  video compression, video conversion, video enhancement, subtitle translation,
  and voice translation.
- Keeps internal package dependencies as `workspace:*` for local development,
  with release consumption intended through the Git repository instead of npm
  central package publishing.
- Adds architecture checks that enforce module ownership, package manifests,
  workspace dependency boundaries, and frontend workflow standards.

### Native Desktop Runtime

- Implements the Tauri 2 desktop host inside the desktop package.
- Adds SQLite migration/runtime support based on the project database contract.
- Ensures every database table follows the required `id` and `uuid` identity
  convention, with `id` represented as a long/integer identity column.
- Adds durable native task records, task events, stage runs, media artifacts,
  and worker leases.
- Adds task-scoped media output directories:
  `outputRootDir/tasks/{task_uuid}/outputs/`.
- Keeps imported source media under the configured workspace input directory.
- Supports configured default output directory from Settings, with a
  platform-specific app data workspace fallback when no directory is set.

### Automatic Intelligent Slicing

- Replaces mock/simulated task and result data with real native task snapshots.
- Implements import-first local video selection and trusted desktop file path
  handling.
- Adds automatic slicing flow through native media import, optional local
  speech-to-text, LLM-backed planning, deterministic fallback planning, and
  native `sliceVideo` execution.
- Persists real slice artifacts under the owning task directory.
- Saves per-slice video files, thumbnails, and optional subtitles as task
  artifacts.
- Adds task detail playback so each generated slice can be selected and played
  independently.
- Removes fake progress and fake success paths from processing services.

### Local Speech-To-Text

- Adds settings-backed local speech transcription configuration.
- Supports Whisper-compatible executable path, model path, default language,
  and toolchain probe behavior.
- Keeps environment variables as a headless fallback:
  `SDKWORK_AUTOCUT_WHISPER_EXECUTABLE` and
  `SDKWORK_AUTOCUT_WHISPER_MODEL`.
- Uses local transcript segments in intelligent slicing when the toolchain is
  ready.
- Fails honestly without generating fake transcript content when local
  transcription is unavailable.

### LLM Configuration

- Adds Settings Center LLM configuration for OpenAI-compatible providers.
- Supports vendor/model configuration with centralized model metadata.
- Adds provider defaults for DeepSeek, OpenAI-compatible, Gemini-compatible,
  and custom-compatible endpoints.
- Stores LLM API keys through the native secret store instead of browser
  storage.
- Isolates development and packaged release settings namespaces:
  `autocut_dev_settings` and `autocut_release_settings`.
- Isolates native LLM secret names between development and release, including
  `dev-default` and `release-default`.
- Adds a settings test action for model connectivity.

### Release Engineering

- Adds pinned Rust `1.90.0` desktop toolchain validation.
- Adds FFmpeg sidecar preparation and release preflight scripts.
- Adds native release smoke evidence generation.
- Requires native release smoke evidence to run the exact
  `autocut_slice_video` FFmpeg slicing artifact test and record
  `autocut-video-slice-smoke=passed` before aggregate release evidence can mark
  `nativeVideoSliceSmokeReady=true`.
- Adds installer signing execution through `pnpm release:sign-installers`, with
  real Authenticode certificate input from a PFX file or Windows certificate
  store thumbprint before signature evidence can pass.
- Adds installer signature evidence generation.
- Adds smart slice task evidence validation for completed transcript-assisted
  task exports before quality scoring.
- Adds repeatable smart slice sample release evidence through
  `pnpm release:smart-slice-sample`, which generates local FFmpeg sample media,
  `artifacts/smart-slice/smart-slice-task.json`,
  `artifacts/release/autocut-smart-slice-sample-evidence.json`,
  `artifacts/release/autocut-smart-slice-quality-evidence.json`, and
  `artifacts/release/autocut-smart-slice-media-artifacts-evidence.json`.
- Adds smart slice quality evidence generation from an exported completed
  `smart-slice-task.json`, producing
  `artifacts/release/autocut-smart-slice-quality-evidence.json`.
- Adds smart slice media artifact evidence generation from the same completed
  task export, producing
  `artifacts/release/autocut-smart-slice-media-artifacts-evidence.json`
  with file existence, byte-size, hash, and root-boundary validation for
  rendered videos, thumbnails, and subtitles.
- Adds a stable workspace TypeScript API runner so release validation can run
  every package typecheck without depending on recursive package-manager
  lifecycle spawning on Windows hosts.
- Adds a smart slice release fixture smoke that validates the task JSON,
  smart slice quality evidence, aggregate release evidence, and commercial
  readiness chain without requiring private media, and writes
  `artifacts/release/autocut-smart-slice-release-fixture.json` as the
  fixture smoke report for CI and release review archives.
- Adds aggregate release evidence generation.
- Adds `pnpm release:preview-ready` as the GitHub/internal unsigned preview
  release gate. It keeps FFmpeg execution, native video slicing, smart slice
  quality/media, installer artifact, and aggregate release evidence checks, but
  records unsigned installers as an explicit preview warning instead of a hard
  blocker.
- Adds commercial release readiness gating.
- Adds cleanup automation for generated build output and runtime artifacts.

### Verification For This Unsigned Preview Release

The release must pass the current Windows host validation flow before the
GitHub Release is created:

- `pnpm typecheck`
- `pnpm test`
- `cargo +1.90.0 test --manifest-path packages/sdkwork-autocut-desktop/src-tauri/Cargo.toml`
- `pnpm build`
- `pnpm tauri:build`
- `pnpm release:smoke-preflight -- --platform windows-x86_64`
- `pnpm release:native-smoke -- --run-real-llm-secret-smoke`
- `pnpm release:smart-slice-sample`
- `pnpm release:installer-signature`
- `pnpm release:smart-slice-task -- --task artifacts/smart-slice/smart-slice-task.json`
- `pnpm release:smart-slice-quality -- --task artifacts/smart-slice/smart-slice-task.json`
- `pnpm release:smart-slice-media-artifacts -- --task artifacts/smart-slice/smart-slice-task.json`
- `pnpm release:smart-slice-fixture`
- `pnpm release:evidence -- --platform windows-x86_64`
- `pnpm release:preview-ready`

This `v0.1.0` is published as an unsigned preview release. `pnpm
release:preview-ready` must pass, and the GitHub Release notes must state that
the MSI/NSIS installers are unsigned.

### Formal Commercial Verification

A formal commercial public release must additionally pass the installer signing
flow:

- `pnpm release:sign-installers`
- `pnpm release:installer-signature`
- `pnpm release:evidence -- --platform windows-x86_64`
- `pnpm release:commercial-ready`

### Dependency Publication Policy

- Local development keeps relative workspace dependencies inside this
  repository.
- Release distribution uses the GitHub repository and release artifacts.
- The application does not publish the AutoCut workspace packages to the npm
  central registry for this release.
- No direct source dependency on `sdkwork-core`, `sdkwork-ui`,
  `sdkwork-appbase`, or `sdkwork-im-sdk` is declared by this repository at
  this release point.

### Included Historical Changes

There were no earlier successful GitHub Releases or tags in this repository
before `v0.1.0`. This release therefore includes the full history from the
initial commit through:

- `b5581d1 fix video cut task state guards`
- `325f9a6 feat: harden video cut release governance`
- `fc023d5 feat: deliver autocut desktop release baseline`
- `d920070 feat(autocut): replace mock workflows with native task logic`
