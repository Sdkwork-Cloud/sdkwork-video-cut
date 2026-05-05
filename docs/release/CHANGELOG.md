# SDKWork Video Cut Release Notes

This directory is the release source of truth for SDKWork Video Cut.

Each GitHub Release must reference the matching version note in this
directory. If a previous version was not successfully released, its change log
must be folded into the next successful release instead of leaving orphaned
release notes.

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
- Adds installer signature evidence generation.
- Adds aggregate release evidence generation.
- Adds commercial release readiness gating.
- Adds cleanup automation for generated build output and runtime artifacts.

### Verification For This Release

The release must pass the current Windows host validation flow before the
GitHub Release is created:

- `pnpm typecheck`
- `pnpm test`
- `cargo +1.90.0 test --manifest-path packages/sdkwork-autocut-desktop/src-tauri/Cargo.toml`
- `pnpm build`
- `pnpm tauri:build`
- `pnpm release:smoke-preflight -- --platform windows-x86_64`
- `pnpm release:native-smoke -- --run-real-llm-secret-smoke`
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

