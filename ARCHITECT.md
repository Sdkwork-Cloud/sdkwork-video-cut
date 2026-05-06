# SDKWork AutoCut Desktop Architecture Standard

## 1. Purpose

This document defines the standard architecture for `sdkwork-video-cut`.

The application is a Tauri desktop product delivered from a workspace package,
not from root-level `src`, `src-tauri`, `index.html`, or `vite.config.ts`.
The root directory is only the workspace orchestrator.

The goals are:

- keep the desktop shell package-local and aligned with `sdkwork-birdcoder`
- keep product UI, visual design, and interaction behavior inside `packages/`
- keep business logic in module service layers
- keep database definitions governed by `DATABASE_SPEC.md`
- make the architecture enforceable through executable checks

## 2. Workspace Structure

```text
project-root/
|-- packages/
|   |-- sdkwork-autocut-desktop/
|   |   |-- public/
|   |   |-- src/
|   |   |-- src-tauri/
|   |   |-- index.html
|   |   |-- package.json
|   |   |-- rust-toolchain.toml
|   |   |-- tsconfig.json
|   |   `-- vite.config.ts
|   |-- sdkwork-autocut-core/
|   |-- sdkwork-autocut-commons/
|   |-- sdkwork-autocut-services/
|   |-- sdkwork-autocut-types/
|   `-- sdkwork-autocut-<feature>/
|-- docs/
|-- scripts/
|-- package.json
|-- pnpm-workspace.yaml
`-- tsconfig.json
```

Root-level runtime entrypoints are not allowed:

- no root `src/`
- no root `src-tauri/`
- no root `index.html`
- no root `vite.config.ts`
- no root `public/`
- no root `dist/` as committed source

## 3. Root Responsibilities

Root `package.json` provides only workspace orchestration:

```bash
pnpm dev
pnpm build
pnpm clean
pnpm typecheck
pnpm test
pnpm tauri:dev
pnpm tauri:build
pnpm check:autocut-architecture
```

Root may depend on `@sdkwork/autocut-desktop` and shared build tools required
to orchestrate the workspace. Runtime/product dependencies belong to
`packages/sdkwork-autocut-desktop/package.json` or to the package that imports
them.

Generated output cleanup must go through:

```bash
pnpm clean
```

The command delegates to `scripts/clean-autocut-generated.mjs`, which removes
only approved generated paths inside the workspace: root `dist/`,
`artifacts/runtime/`, desktop package `dist/`, desktop Tauri `target/`, and
desktop Tauri `gen/`.

## 4. Desktop Package Responsibilities

`packages/sdkwork-autocut-desktop` is the only desktop application package.

It owns:

- React bootstrap
- route assembly
- global stylesheet entry
- Vite config
- Tauri config and Rust crate
- desktop static assets
- desktop build scripts

It must stay a thin shell. It must not own AutoCut feature business logic,
mock data, processing workflows, or reusable product UI.

Allowed package root entries:

```text
dist/               # generated, ignored
index.html
node_modules/       # generated, ignored
package.json
public/
rust-toolchain.toml
src/
src-tauri/
tsconfig.json
vite.config.ts
```

Allowed source files in the desktop shell:

```text
src/App.tsx
src/index.ts
src/main.tsx
src/index.css
src/vite-env.d.ts
```

`App.tsx` may compose routes and providers only. Product pages must be
lazy-loaded from `@sdkwork/autocut-*` packages.

Allowed desktop static assets:

```text
public/favicon.svg
```

## 5. Package Naming Standard

Package directories use:

```text
sdkwork-autocut-<module>
```

Package manifest names use:

```text
@sdkwork/autocut-<module>
```

All internal dependencies must use `workspace:*`. External versions must come
from `pnpm-workspace.yaml` catalog entries unless a specific exception is
documented and enforced.

## 6. Package Manifest Standard

Library and feature packages must expose only `src/index.ts`:

```json
{
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "module": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "tsc --noEmit"
  }
}
```

The desktop package is the exception for build scripts because it produces the
Vite and Tauri desktop bundle:

```json
{
  "scripts": {
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "tsc --noEmit",
    "tauri:dev": "pnpm exec tauri dev",
    "tauri:build": "pnpm exec tauri build"
  }
}
```

## 7. Feature Package Layering

Feature packages should use this structure:

```text
src/
  pages/
  components/
  service/
  types/
  hooks/
  store/
  index.ts
```

Rules:

- `pages/` handles page composition and user interaction binding.
- `components/` handles module-local UI rendering.
- `service/` owns business workflows, mock behavior, storage adaptation, and
  data transformation.
- `types/` owns module-local contracts.
- `src/index.ts` is the only public API boundary.
- Root files under `src/` are limited to `index.ts` for non-desktop packages.

## 8. Service Layer Rules

Business processing must live in service layers.

Pages and components must not:

- own large mock datasets
- construct task or asset entities directly when a workflow service exists
- call shared low-level storage functions to bypass a workflow
- create `Blob` or object URLs directly
- call browser globals such as `confirm`, clipboard, or preview windows
- scatter date parsing, sorting, and formatting logic
- emit raw AutoCut custom event strings

Shared helpers are centralized in `@sdkwork/autocut-services`, including:

- `storage.service.ts`
- `events.service.ts`
- `diagnostics.service.ts`
- `download.service.ts`
- `browser.service.ts`
- `identity.service.ts`
- `datetime.service.ts`
- `media-fixtures.service.ts`
- `processing-source.service.ts`
- `runtime-environment.service.ts`

Processing workflows must validate source media before task creation through
`validateAutoCutProcessingSource`. Every non-slicer workflow requires an
uploaded `File` or selected asset `fileId`. The slicer workflow may explicitly
allow external URLs with `allowExternalUrl: true`, and those URLs must parse as
`http:` or `https:`. Missing source media, blank URLs, and unsafe protocols must
be rejected before `addTask`, `addAsset`, progress simulation, or messages run.

Processing workflows must also keep inputs and outputs traceable. When a task
starts from an asset-library selection, `AppTask` records `sourceFileId`. A
completed `AppTask` records `generatedAssetIds`, and each generated `AppAsset`
records `sourceTaskId` plus `sourceTaskType`. Imported assets, folders, uploaded
files, and external URLs may leave those trace fields unset when they are not
selected from the asset library or produced by a task.

Automatic intelligent slicing must be transcript-assisted in desktop native
mode when local speech-to-text is configured. The standard flow is:
`autocut_import_media_file` -> optional `autocut_transcribe_media` ->
`autocut_slice_video`. `autocut_transcribe_media` accepts `assetUuid`, optional
`language`, optional `outputRootDir`, and optional settings-backed local
speech-to-text `executablePath` plus `modelPath`; it must never accept raw media
paths from the renderer. The native host extracts mono 16 kHz WAV with FFmpeg
and calls a local Whisper-compatible executable. The Settings Center is the
primary configuration surface for the local speech toolchain, including
executable path, model path, default language, and a click-to-test probe.
`SDKWORK_AUTOCUT_WHISPER_EXECUTABLE` plus `SDKWORK_AUTOCUT_WHISPER_MODEL` remain
a headless fallback. `speechTranscriptionToolchainReady` reports only fallback
environment readiness, so frontend workflows must also honor the settings-backed
runtime config before deciding transcription is unavailable. If the selected
toolchain is missing or invalid, the command fails closed without fake text.
Successful transcript JSON files are saved under the task output directory and
registered as media artifacts. The slicer service must use the returned
transcript segments as semantic candidates and LLM prompt context, and must
degrade to the non-transcript plan if local transcription fails.
When subtitle generation is enabled, the slicer service must forward the real
local transcript segments to `autocut_slice_video` as `subtitleSegments` with
`subtitleFormat: "srt"`. The native host must generate one SRT subtitle file per
slice only from those real segments, store it under the same
`{outputRootDir}/tasks/{task_uuid}/outputs/` directory, register a subtitle
`media_artifact`, and return `subtitleArtifactPath` plus `subtitleFormat` in the
corresponding slice result. If no local transcript segments are available, the
workflow must not create fake subtitle files.

Runtime environment selection is a service-layer contract. The desktop entry
must call `configureAutoCutRuntimeEnvironment(import.meta.env.DEV ? 'dev' :
'release')` before configuring the native host or the AI SDK bridge. Browser
key-value storage is environment scoped through `storage.service.ts`: development
settings persist under `autocut_dev_settings`, release settings persist under
`autocut_release_settings`, and the same `autocut_dev_*` / `autocut_release_*`
pattern applies to tasks, assets, and messages. LLM API keys must never be
stored in browser storage. They are saved through the native secret store with
runtime-scoped names: `dev-default` for development and `release-default` for
packaged release. Transient in-memory LLM API keys are also keyed by runtime
environment so switching between dev and release cannot reuse another
environment's credentials or model configuration.

The workspace `outputDirectory` is also environment scoped through the same
settings storage boundary. It is the configurable native media output root used
by desktop media workflows. If it is blank or missing, the desktop host falls
back to the app data media root. Native commands receive the configured root as
`outputRootDir`; it must be an absolute directory path. The runtime creates and
canonicalizes the directory before use. Imported source copies are stored under
`{outputRootDir}/inputs/`; generated task results are stored under
`{outputRootDir}/tasks/{task_uuid}/outputs/`.

## 9. Domain Type Standard

Shared domain enumerations must be canonical constants in
`@sdkwork/autocut-types`.

Current required examples:

- `AUTOCUT_TASK_TYPES`
- `AUTOCUT_TASK_STATUS`
- `TaskType`
- `TaskStatus`
- `isAutoCutTaskActiveStatus`

Feature modules should use `Record<TaskType, ...>` or `TaskStatus` instead of
duplicating string literal sets.

## 10. Dependency Direction

Use one-way dependencies:

```text
types
  -> commons / core
  -> services
  -> feature packages
  -> desktop shell
```

Rules:

- `types` must not depend on feature packages.
- `commons` must not depend on feature packages.
- Feature packages may depend on `types`, `commons`, `core`, and `services`.
- Feature packages should avoid depending on each other unless the contract is
  explicit and declared.
- Packages must never depend on the desktop package.

## 11. Tauri Standard

Tauri is package-local:

```text
packages/sdkwork-autocut-desktop/src-tauri/
```

The Tauri shell owns only native desktop launch, window configuration, CSP,
asset bundling, and future native host integration boundaries. It must not
implement AutoCut product workflows.

Required invariants:

- `frontendDist` points to `../dist` from the package-local `src-tauri`
  directory.
- `devUrl` uses loopback.
- Vite development uses strict loopback ports.
- CSP is non-null and starts from `default-src 'self'`.
- `packages/sdkwork-autocut-desktop/rust-toolchain.toml` pins Rust `1.90.0`
  for deterministic Tauri release builds.
- generated `src-tauri/gen/` output is ignored and not tracked.
- `src-tauri/` root entries are limited to `build.rs`, `Cargo.lock`,
  `Cargo.toml`, `database/`, `gen/`, `icons/`, `src/`, `target/`, and
  `tauri.conf.json`.
- `src-tauri/src/` owns only `main.rs`, `commands.rs`, `host_contract.rs`,
  `database_contract.rs`, `database_runtime.rs`, and `media_runtime.rs` until
  additional native processing contracts are specified.
- The exposed product commands are `autocut_host_capabilities`,
  `autocut_database_health`, `autocut_ffmpeg_probe`,
  `autocut_import_media_file`, `autocut_describe_local_media_file`,
  `autocut_select_local_video_file`, `autocut_select_local_directory`,
  `autocut_list_native_tasks`, `autocut_cancel_native_task`,
  `autocut_recover_native_tasks`, `autocut_retry_native_task`,
  `autocut_extract_audio`, `autocut_generate_gif`,
  `autocut_compress_video`, `autocut_convert_video`,
  `autocut_enhance_video`, and
  `autocut_audio_smoke`.
  They report the
  package-local native host contract version, SQLite migration readiness,
  database health command readiness, FFmpeg probe command readiness, media
  import command readiness, local file describe command readiness, trusted local
  video chooser readiness, trusted local directory chooser readiness, audio
  extraction command readiness, assetUuid extraction readiness, video GIF command
  readiness, video compression command readiness, video conversion command
  readiness, video enhancement command readiness, native task query command
  readiness, native task cancel command readiness, native task recovery command
  readiness, native task retry command readiness, native task progress event
  readiness, FFmpeg toolchain manifest readiness, FFmpeg toolchain resolver
  readiness, bundled FFmpeg readiness, database contract readiness, and the
  current `ffmpegExecutionReady` state.
- The package-local FFmpeg toolchain contract is
  `packages/sdkwork-autocut-desktop/src-tauri/binaries/ffmpeg.toolchain.json`.
  The manifest has a versioned `contractVersion`, explicit FFmpeg license
  metadata, platform directories (`windows-x86_64`, `linux-x86_64`,
  `macos-x86_64`, `macos-aarch64`), and per-platform integrity metadata
  (`sha256` and `byteSize`). The resolver checks `SDKWORK_AUTOCUT_FFMPEG`
  first, then a platform sidecar declared under the Tauri `resource_dir`, then
  the package-local source manifest during development, then the manifest
  `requiredBinary` on `PATH` as a development fallback. A bundled sidecar is
  accepted only when the file exists and its size plus SHA-256 digest match the
  manifest. Probe responses expose `sourceKind`, `manifestReady`, and
  `bundledReady` for diagnostics. `ffmpegToolchainManifestReady` and
  `ffmpegToolchainResolverReady` report only this standardized contract; they do
  not imply bundled or production execution readiness.
  `scripts/prepare-autocut-ffmpeg-sidecar.mjs` is the only standard way to
  register a real sidecar in source: it requires an explicit platform, source
  file, and `--accept-license`, then copies the binary into the package-local
  platform directory and rewrites `sha256`, `byteSize`, and `bundledReady`.
  Bundled FFmpeg sidecar binaries must be stored through Git LFS by the root
  `.gitattributes` policy because approved platform binaries can exceed normal
  Git host single-file limits; the JSON toolchain manifest and platform
  `.gitkeep` files remain normal text Git objects.
  `scripts/check-autocut-release-smoke-preflight.mjs` verifies the manifest,
  sidecar presence, integrity, and optional executable smoke before release.
  `--require-bundled` is the release gate once an approved sidecar is supplied;
  without an approved sidecar the preflight remains honest and reports
  `bundledReady=false` / `ffmpegExecutionReady=false`.
  `scripts/write-autocut-native-release-smoke.mjs` writes the structured native
  command smoke evidence under `artifacts/release/` by running the pinned Rust
  smoke suite. The evidence matrix currently covers `autocut_host_capabilities`,
  `autocut_ffmpeg_probe`, `autocut_audio_smoke`, `autocut_slice_video`, and
  `autocut_recover_native_tasks`, including the durable worker lease recovery
  behavior. The `autocut_slice_video` entry is backed by the exact
  `media_runtime::tests::video_slice_from_asset_registers_each_slice_artifact_inside_task_output_dir`
  smoke and must record `videoSliceSmokeReady=true` plus
  `autocut-video-slice-smoke=passed`, proving real FFmpeg slicing, task-scoped
  video artifacts, thumbnails, task output JSON, and database stage completion
  before aggregate release evidence can mark `nativeVideoSliceSmokeReady=true`.
  The LLM secret commands are not considered release-ready from the
  default mock keyring tests. Release evidence must run
  `pnpm release:native-smoke -- --run-real-llm-secret-smoke` on Windows, or set
  `SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE=true`, so the ignored
  `real_windows_keyring_store_saves_reads_and_deletes_llm_secret` test writes,
  reads, and deletes a real Windows Credential Manager entry. The evidence must
  record `realLlmSecretStoreSmokeReady=true` before the LLM secret command
  matrix entries may be ready. The script sets isolated temporary
  `CARGO_TARGET_DIR` values named `sdkwork-autocut-native-smoke-target-rust-*`,
  `sdkwork-autocut-native-smoke-target-video-slice-*`,
  and `sdkwork-autocut-native-smoke-target-llm-secret-*` for the full native
  smoke and the serialized real secret-store smoke. This keeps release smoke
  from contending with developer `cargo test`, Tauri packaging, package-local
  `src-tauri/target` artifacts, or a previous Windows linker handle for the
  same test executable. It is the standard
  bridge between Rust/Tauri command tests and the release evidence bundle, and
  it must not claim `ffmpegExecutionReady` by itself; aggregate release evidence
  derives that flag only after sidecar integrity, executable smoke, native
  smoke, smart slice quality/media evidence, installer signature, and release
  smoke are all ready.
  `scripts/write-autocut-smart-slice-sample-evidence.mjs` is the repeatable
  local release-evidence path when no private exported task JSON is attached to
  the release review. It generates FFmpeg-backed sample source/slice media
  under ignored `artifacts/smart-slice-media/`, writes
  `artifacts/smart-slice/smart-slice-task.json`, then writes the sample report,
  smart slice quality evidence, and media artifact evidence under
  `artifacts/release/`.
  `scripts/sign-autocut-release-installers.mjs` is the installer signing
  execution boundary. It accepts a real Authenticode source through
  `SDKWORK_AUTOCUT_WINDOWS_SIGNING_PFX` plus
  `SDKWORK_AUTOCUT_WINDOWS_SIGNING_PASSWORD`, or through
  `SDKWORK_AUTOCUT_WINDOWS_SIGNING_THUMBPRINT` for a Windows certificate-store
  certificate. It may use `SDKWORK_AUTOCUT_SIGNTOOL_PATH` for a specific
  `signtool.exe`, and it must fail closed when the signing certificate or tool
  is absent.
  `scripts/write-autocut-installer-signature-evidence.mjs` writes the structured
  MSI/NSIS code-signing evidence under `artifacts/release/`. Unsigned or
  unverifiable installers must produce `installerSignatureReady=false` with
  `INSTALLER_SIGNATURE_MISSING` blockers instead of being treated as commercial
  release artifacts.
  `scripts/write-autocut-release-evidence.mjs` writes the structured release
  evidence JSON under `artifacts/release/`, including installer paths, byte
  sizes, SHA-256 digests, FFmpeg manifest state, release smoke preflight state,
  native command smoke evidence, smart slice quality/media evidence, installer
  signature evidence, and the derived `ffmpegExecutionReady` readiness boundary.
  `scripts/check-autocut-preview-release-readiness.mjs` is the unsigned preview
  release gate for GitHub/internal test releases. It keeps FFmpeg execution,
  native video slice, smart slice quality/media, installer artifact, and
  aggregate release smoke checks, but unsigned installers are reported as
  `UNSIGNED_INSTALLERS_ACCEPTED_FOR_PREVIEW` warnings instead of commercial
  release blockers.
  `scripts/check-autocut-commercial-release-readiness.mjs` is the final
  commercial-release hard gate. It must fail until bundled FFmpeg integrity,
  executable smoke, native smoke, smart slice quality/media evidence, installer
  signature, aggregate release smoke, and `ffmpegExecutionReady` are all ready.
- `rusqlite` is allowed only with bundled SQLite after the database contract is
  present. `tauri-plugin-*`, `tokio`, `reqwest`, and SQLx remain forbidden until
  a matching architecture contract is written.
- The current native media runtime can import a user-selected media file into
  the package-local sandbox, register `media_asset`, process audio extraction by
  `assetUuid`, generate GIF artifacts by `assetUuid`, compress video artifacts
  by `assetUuid`, convert video artifacts by `assetUuid`, enhance video
  artifacts by `assetUuid`, and register `ops_task`, `ops_stage_run`, and
  `media_artifact`. It can also describe a trusted dropped local path without
  copying media or writing database rows, select a trusted local video through
  the operating-system file picker, probe FFmpeg, and run a deterministic
  audio smoke through `media_runtime.rs`. It exposes
  `autocut_list_native_tasks` so the webview can inspect persisted `ops_task`,
  `ops_stage_run`, and `ops_task_event` snapshots without reading SQLite
  directly. It also exposes `autocut_cancel_native_task`, which may request
  cancellation only for the current desktop process' tracked native media
  process, including FFmpeg and local speech-to-text child processes, and
  records `cancel_requested` / `canceled` task events through `ops_task_event`.
  The cancel command must not mutate completed, failed, untracked, or recovered
  tasks blindly. `autocut_recover_native_tasks` is the
  startup recovery boundary: current-session tracked tasks are left untouched,
  stale expired `ops_worker_lease` rows are marked expired, stale `processing`
  tasks become `interrupted`, and stale `cancel_requested` tasks become
  `canceled`, with audit events in `ops_task_event`. Recovery must defer
  untracked tasks that still have an active unexpired worker lease, and
  `AutoCutNativeTaskRecoveryResult` reports `expiredLeases` and `deferred`
  counts for diagnostics.
  `autocut_retry_native_task` creates a new standard native task from a
  retryable `failed`, `canceled`, or `interrupted` source task's persisted
  `input_json`; it appends a retry requested event to the source task and never
  overwrites the source terminal state. Native progress is exposed through the
  existing `autocut_list_native_tasks` snapshots: `ops_task.progress` is the
  latest persisted percentage and `OPS_TASK_EVENT_TYPE_PROGRESS` rows in
  `ops_task_event` are the audit trail. Native progress writes are processing
  only, monotonic, clamped below 100 until completion, and parsed through the
  `parse_ffmpeg_progress_percent` contract when FFmpeg progress text is
  available. FFmpeg execution streams `-progress pipe:1` through
  `run_tracked_ffmpeg_command_with_progress` and persists accepted updates with
  `record_ffmpeg_streaming_progress`, so progress is written while the native
  process is still tracked rather than only after process exit. The native media
  process runner must stop and join child-process pipe readers when a progress
  or poll callback fails, so FFmpeg and local speech-to-text cannot continue as
  orphaned background work after database heartbeat, progress, or cancellation
  coordination fails. Local speech-to-text polling must be throttled through a
  fixed native media heartbeat interval instead of writing SQLite lease
  heartbeats on every process wait loop, and the native runner must force one
  final heartbeat after the local speech-to-text process exits before joining
  pipes and completing the operation. Native task event observability uses a
  two-track contract:
  `payloadJson` preserves the raw
  `ops_task_event.payload_json` audit row, while `payload` is the parsed stable
  object exposed by `AutoCutNativeTaskEventSnapshot`. All native event writes pass
  through `standardize_native_task_event_payload`, which guarantees `phase` and
  `source`, and guarantees `operation`/`progress` for progress events and
  `progress: 100` for completion events. Durable native execution is anchored by
  `ops_worker_lease`: every native media operation acquires one active worker
  lease before native media execution, heartbeats it while FFmpeg or local
  speech-to-text is still running, releases it on completed/failed/canceled
  paths, and exposes the audit trail as `AutoCutNativeTaskSnapshot.workerLeases`.
  The `nativeWorkerLeaseReady`
  capability reports that this lease baseline exists. However,
  `ffmpegExecutionReady` remains false until FFmpeg is bundled and the full
  durable worker/recovery workflow is wired.
- Frontend code must access native commands only through
  `native-host-client.service.ts` in `@sdkwork/autocut-services`. The service
  defines the typed command contract, browser fallback, and native artifact URL
  conversion. `packages/sdkwork-autocut-desktop/src/native-host.ts` is the only
  desktop source file allowed to import `@tauri-apps/api/core` and
  `@tauri-apps/api/webview`; it adapts Tauri `invoke`, `convertFileSrc`, and
  `getCurrentWebview().onDragDropEvent` into the canonical native host client
  plus trusted file source bridge.
- Browser `File` objects do not expose a trustworthy absolute source path.
  Native media workflows may call `autocut_import_media_file` only when the
  selected file contains explicit desktop-provided `path` or `sourcePath`
  metadata. Without that trusted path, feature services must keep the
  browser/mock workflow and must not guess paths, construct raw local paths, or
  use `file://` URLs.
- Homepage smart slicing must prefer `autocut_select_local_video_file` through
  the typed native host client, convert the returned descriptor with
  `createAutoCutTrustedLocalFile`, and pass that trusted File-compatible value
  to `/slicer`. The HTML file chooser remains only a non-desktop fallback.
- `@sdkwork/autocut-commons` owns `trusted-file-source.service.ts`, which turns
  trusted Tauri dropped paths into File-compatible values with `sourcePath`,
  `path`, `name`, `type`, `size`, `byteSize`, and `mediaType` while preserving
  the existing `FileUpload` visual design. Feature services read this metadata
  through `resolveAutoCutTrustedSourcePath`.
- The audio extractor service is the current native-capable reference workflow.
  Under the trusted-path gate it uses `getAutoCutNativeHostClient`, runs
  `importMediaFile -> extractAudio` by `assetUuid`, converts the returned
  `artifactPath` to an asset URL, persists the generated `AppAsset`, and
  completes the `AppTask` with `generatedAssetIds` plus `audioUrl`.
- The video GIF service follows the same native-capable workflow. Under the
  trusted-path gate it runs `importMediaFile -> generateGif` by `assetUuid`,
  converts the native `artifactPath` through the asset URL factory, persists the
  generated image `AppAsset`, and completes the `AppTask` with
  `generatedAssetIds` plus `gifUrl`.
- The video compression service follows the same native-capable workflow. Under
  the trusted-path gate it runs `importMediaFile -> compressVideo` by
  `assetUuid`, converts the native `artifactPath` through the asset URL factory,
  persists the generated video `AppAsset`, and completes the `AppTask` with
  `generatedAssetIds`, `videoUrl`, and `fileSizeStats`.
- The video conversion service follows the same native-capable workflow. Under
  the trusted-path gate it runs `importMediaFile -> convertVideo` by
  `assetUuid`, converts the native `artifactPath` through the asset URL factory,
  persists the generated video `AppAsset`, and completes the `AppTask` with
  `generatedAssetIds` plus `videoUrl`.
- The video enhancement service follows the same native-capable workflow. Under
  the trusted-path gate it runs `importMediaFile -> enhanceVideo` by
  `assetUuid`, converts the native `artifactPath` through the asset URL factory,
  persists the generated video `AppAsset`, and completes the `AppTask` with
  `generatedAssetIds` plus `videoUrl`.

Rust verification must use the package-local manifest:

```bash
cargo +1.90.0 check --manifest-path packages/sdkwork-autocut-desktop/src-tauri/Cargo.toml
```

When running through package scripts, `pnpm --filter @sdkwork/autocut-desktop
tauri:build` and root `pnpm tauri:build` execute from the desktop package, so
rustup resolves the pinned package-local toolchain automatically.

The Rust toolchain guard has its own executable contract test:

```bash
node scripts/ensure-autocut-tauri-rust-toolchain.test.mjs
```

Root `pnpm test` must run this contract before workspace package tests.

## 12. Database Standard

`DATABASE_SPEC.md` is the canonical database definition standard.

The package-local native host baseline includes:

- `packages/sdkwork-autocut-desktop/src-tauri/database/schema/sqlite/001_baseline.sql`
- `packages/sdkwork-autocut-desktop/src-tauri/database/schema-registry/autocut_host_baseline.yaml`
- `packages/sdkwork-autocut-desktop/src-tauri/src/database_contract.rs`
- `packages/sdkwork-autocut-desktop/src-tauri/src/database_runtime.rs`

The baseline contains `ops_schema_migration` as the local forward-migration
history table. The native runtime function `run_autocut_database_migrations`
applies `001_baseline.sql` idempotently and `autocut_database_health` is the only
Tauri command allowed to trigger or inspect the database baseline.

Native media persistence follows an import-first rule. `autocut_import_media_file`
is the only command that may accept a raw local source path from the webview; it
copies the file into `{outputRootDir}/inputs/` and writes a `media_asset` row.
Later media processing commands, including `autocut_extract_audio`, must accept
`assetUuid` and `autocut_generate_gif`, `autocut_slice_video`, and
`autocut_compress_video` must resolve the sandbox path from
`media_asset.source_uri`. `autocut_convert_video` follows the same assetUuid
rule for format conversion, and `autocut_enhance_video` follows the same rule
for deterministic FFmpeg enhancement. Imported source files stay under
`{outputRootDir}/inputs/`; generated native task files are written under
`{outputRootDir}/tasks/{task_uuid}/outputs/`. Each native media operation owns
exactly one task output directory. Multi-artifact operations such as intelligent
video slicing must normalize LLM candidate clips before native execution:
candidates are sorted by `startMs`, clamped to configured duration bounds, filled
with deterministic non-overlapping gaps until the standard clip count is
reached, and then passed to `autocut_slice_video`. The native command must place
  every slice in that task directory, register one
  `media_artifact` row per slice, generate one JPEG thumbnail per slice in the
  same `outputs/` directory, register a thumbnail `media_artifact` row linked to
  the slice, optionally generate one SRT subtitle artifact per slice when real
  local transcript segments were supplied, and persist
  `ops_task.output_json.sliceResults` with `artifactPath`,
  `thumbnailArtifactPath`, and optional `subtitleArtifactPath`. The returned
  `artifactPath`, `thumbnailArtifactPath`, optional `subtitleArtifactPath`, and
  `media_artifact.uri` must point to files inside that directory, while
  `ops_task.input_json` records `outputRootDir` when one was
  configured so retry can preserve the original output root. `ops_task.output_json`
  and `media_artifact.metadata_json` must include `taskOutputDir` for traceability.
Generated files are linked through `media_artifact.source_asset_uuid` and traced
through `ops_task` plus `ops_stage_run`. If source-duration filtering leaves no
usable slice clips, the native runtime must fail the already-created `ops_task`
with an audit event and must not report a completed task with zero slices.

Any SQL, YAML, JSON schema registry, DTO, ORM, or migration definition must
follow:

- every table has `id`
- every table has `uuid`
- `id` is logical `int64`, mapped to long/64-bit integer semantics
- table names use business module prefixes
- product, project, organization, and legacy prefixes such as `autocut`,
  `video_cut`, `sdkwork`, `plus`, `app`, `sys`, and `common` are forbidden

The AutoCut-specific database contract is documented in
`docs/architecture/17-autocut-database-contract-standard.md`.

## 13. Governance

The executable standard is:

```bash
pnpm check:autocut-architecture
```

The check enforces:

- package naming and manifests
- root versus desktop package boundaries
- standardized generated-output cleanup
- Rust toolchain guard contract coverage
- package-local Tauri/Vite/HTML ownership
- direct dependency declarations
- workspace catalog usage
- service layer boundaries
- canonical task types and task statuses
- browser helper boundaries
- diagnostics, storage, datetime, and download helpers
- database contract invariants
- absence of legacy AI Studio/server/runtime source trees

No architecture decision is complete until this command, TypeScript, tests,
Vite build, Rust check, and Tauri build all pass.
